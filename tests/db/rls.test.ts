import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, connect, createProfile, createUser, expectPgError } from "./helpers";

let admin: Client;
let userA: string;
let userB: string;
let profileA: string;
let profileB: string;
let taskB: string;

beforeAll(async () => {
  admin = await connect();
  userA = await createUser(admin);
  userB = await createUser(admin);
  profileA = await createProfile(admin, userA, "berlin");
  profileB = await createProfile(admin, userB, "frankfurt");
  const { rows } = await admin.query<{ id: string }>(
    "insert into public.user_tasks (user_id, profile_id, title) values ($1, $2, 'B task') returning id",
    [userB, profileB],
  );
  taskB = rows[0]!.id;
});

afterAll(async () => {
  await admin.query("delete from auth.users where id = any($1::uuid[])", [[userA, userB]]);
  await admin.end();
});

describe("user data isolation (AC-01-6)", () => {
  it("a user sees only their own profile", async () => {
    const rows = await asUser(admin, userA, async (c) => (await c.query("select id from public.profiles")).rows);
    expect(rows.map((r) => r.id)).toEqual([profileA]);
  });

  it("a user cannot update another user's profile", async () => {
    const count = await asUser(admin, userA, async (c) =>
      (await c.query("update public.profiles set city = 'hacked' where id = $1", [profileB])).rowCount,
    );
    expect(count).toBe(0);
    const { rows } = await admin.query("select city from public.profiles where id = $1", [profileB]);
    expect(rows[0].city).toBe("frankfurt");
  });

  it("a user cannot create a profile for someone else", async () => {
    await asUser(admin, userA, (c) =>
      expectPgError(
        c.query("insert into public.profiles (user_id, move_purpose, city) values ($1, 'study', 'berlin')", [userB]),
        /row-level security/,
      ),
    );
  });

  it("a user cannot read or modify another user's tasks", async () => {
    await asUser(admin, userA, async (c) => {
      expect((await c.query("select * from public.user_tasks where id = $1", [taskB])).rowCount).toBe(0);
      expect((await c.query("update public.user_tasks set status = 'completed' where id = $1", [taskB])).rowCount).toBe(0);
      expect((await c.query("delete from public.user_tasks where id = $1", [taskB])).rowCount).toBe(0);
    });
  });

  it("a user cannot attach a task to another user's profile", async () => {
    await asUser(admin, userA, (c) =>
      expectPgError(
        c.query("insert into public.user_tasks (user_id, profile_id, title) values ($1, $2, 'x')", [userA, profileB]),
        /foreign key|row-level security/,
      ),
    );
  });

  it("a user can manage their own tasks", async () => {
    await asUser(admin, userA, async (c) => {
      const { rows } = await c.query(
        "insert into public.user_tasks (user_id, profile_id, title) values ($1, $2, 'mine') returning id",
        [userA, profileA],
      );
      const upd = await c.query("update public.user_tasks set status = 'in_progress' where id = $1", [rows[0].id]);
      expect(upd.rowCount).toBe(1);
    });
  });

  it("anonymous visitors cannot read any user data", async () => {
    await asAnon(admin, async (c) => {
      expect((await c.query("select * from public.profiles")).rowCount).toBe(0);
      expect((await c.query("select * from public.user_tasks")).rowCount).toBe(0);
    });
  });
});

describe("reference data is read-only for users", () => {
  it("authenticated users can read templates and sources", async () => {
    const counts = await asUser(admin, userA, async (c) => ({
      templates: (await c.query("select 1 from public.task_templates")).rowCount,
      sources: (await c.query("select 1 from public.source_documents")).rowCount,
    }));
    expect(counts.templates).toBe(30);
    expect(counts.sources).toBeGreaterThanOrEqual(14);
  });

  it("authenticated users cannot modify templates or sources", async () => {
    await asUser(admin, userA, async (c) => {
      expect((await c.query("update public.task_templates set title = 'x'")).rowCount).toBe(0);
      expect((await c.query("delete from public.source_documents")).rowCount).toBe(0);
    });
    await asUser(admin, userA, (c) =>
      expectPgError(
        c.query(
          "insert into public.task_templates (template_key, category, title, description, region_scope, applicability, verification_status) values ('x.y', 'telecom', 't', 'd', 'federal', '{}', 'draft')",
        ),
        /row-level security/,
      ),
    );
  });

  it("anonymous visitors cannot read templates", async () => {
    const n = await asAnon(admin, async (c) => (await c.query("select 1 from public.task_templates")).rowCount);
    expect(n).toBe(0);
  });
});

describe("evaluation results are public but write-protected (AC-06-4)", () => {
  it("anonymous visitors can read evaluation cases", async () => {
    const n = await asAnon(admin, async (c) => (await c.query("select 1 from public.evaluation_cases")).rowCount);
    expect(n).toBeGreaterThanOrEqual(10);
  });

  it("nobody but the server can write evaluation data", async () => {
    await asAnon(admin, (c) =>
      expectPgError(
        c.query("insert into public.evaluation_runs (model_id, prompt_version, git_sha) values ('m', 'p', 'abcdef1')"),
        /permission denied|row-level security/,
      ),
    );
    await asUser(admin, userA, (c) =>
      expectPgError(
        c.query("insert into public.evaluation_runs (model_id, prompt_version, git_sha) values ('m', 'p', 'abcdef1')"),
        /row-level security/,
      ),
    );
  });
});

describe("AI run log", () => {
  it("users read only their own runs and cannot write runs", async () => {
    await admin.query(
      "insert into public.ai_runs (user_id, feature, model_id, prompt_version, input_hash, validation_status) values ($1, 'rag_answer', 'm', 'v1', 'h', 'valid'), ($2, 'rag_answer', 'm', 'v1', 'h', 'valid')",
      [userA, userB],
    );
    await asUser(admin, userA, async (c) => {
      const { rows } = await c.query("select user_id from public.ai_runs where user_id = any($1::uuid[])", [[userA, userB]]);
      expect(rows.map((r) => r.user_id)).toEqual([userA]);
      await expectPgError(
        c.query("insert into public.ai_runs (user_id, feature, model_id, prompt_version, input_hash, validation_status) values ($1, 'rag_answer', 'm', 'v1', 'h', 'valid')", [userA]),
        /row-level security/,
      );
    });
  });
});
