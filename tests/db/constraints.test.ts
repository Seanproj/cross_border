import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connect, createProfile, createUser, expectPgError } from "./helpers";

let admin: Client;
let user: string;
let profile: string;

beforeAll(async () => {
  admin = await connect();
  user = await createUser(admin);
  profile = await createProfile(admin, user);
});

afterEach(async () => {
  // a failed statement inside an explicit transaction leaves it aborted
  await admin.query("rollback").catch(() => {});
});

afterAll(async () => {
  await admin.query("delete from auth.users where id = $1", [user]);
  await admin.end();
});

const templateId = async (key: string) =>
  (await admin.query<{ id: string }>("select id from public.task_templates where template_key = $1", [key])).rows[0]!.id;

describe("profile validation (AC-01-1)", () => {
  it("rejects unknown move purposes and malformed state codes", async () => {
    const other = await createUser(admin);
    await expectPgError(
      admin.query("insert into public.profiles (user_id, move_purpose, city) values ($1, 'tourism', 'berlin')", [other]),
      /profiles_move_purpose_check/,
    );
    await expectPgError(
      admin.query("insert into public.profiles (user_id, move_purpose, city, state_code) values ($1, 'study', 'berlin', 'Berlin')", [other]),
      /profiles_state_code_check/,
    );
    await expectPgError(
      admin.query("insert into public.profiles (user_id, move_purpose, city) values ($1, 'study', '   ')", [other]),
      /profiles_city_check/,
    );
    await admin.query("delete from auth.users where id = $1", [other]);
  });

  it("allows only one profile per user", async () => {
    await expectPgError(createProfile(admin, user), /duplicate key/);
  });
});

describe("user task rules (AC-02-3)", () => {
  it("sets and clears completed_at with the status", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "insert into public.user_tasks (user_id, profile_id, title) values ($1, $2, 't') returning id",
      [user, profile],
    );
    const id = rows[0]!.id;
    await admin.query("update public.user_tasks set status = 'completed' where id = $1", [id]);
    let r = await admin.query("select completed_at from public.user_tasks where id = $1", [id]);
    expect(r.rows[0].completed_at).not.toBeNull();
    await admin.query("update public.user_tasks set status = 'in_progress' where id = $1", [id]);
    r = await admin.query("select completed_at from public.user_tasks where id = $1", [id]);
    expect(r.rows[0].completed_at).toBeNull();
  });

  it("rejects unknown statuses", async () => {
    await expectPgError(
      admin.query("insert into public.user_tasks (user_id, profile_id, title, status) values ($1, $2, 't', 'done')", [user, profile]),
      /user_tasks_status_check/,
    );
  });

  it("does not allow the same template twice in one checklist", async () => {
    const tid = await templateId("de.housing.secure_residence");
    await admin.query("insert into public.user_tasks (user_id, profile_id, template_id, title) values ($1, $2, $3, 't')", [user, profile, tid]);
    await expectPgError(
      admin.query("insert into public.user_tasks (user_id, profile_id, template_id, title) values ($1, $2, $3, 't')", [user, profile, tid]),
      /duplicate key/,
    );
  });

  it("rejects a dependency between tasks of different users", async () => {
    const other = await createUser(admin);
    const otherProfile = await createProfile(admin, other);
    const mine = (await admin.query("insert into public.user_tasks (user_id, profile_id, title) values ($1, $2, 'm') returning id", [user, profile])).rows[0].id;
    const theirs = (await admin.query("insert into public.user_tasks (user_id, profile_id, title) values ($1, $2, 'o') returning id", [other, otherProfile])).rows[0].id;
    await expectPgError(
      admin.query("insert into public.user_task_dependencies (user_id, task_id, depends_on_task_id) values ($1, $2, $3)", [user, mine, theirs]),
      /foreign key/,
    );
    await admin.query("delete from auth.users where id = $1", [other]);
  });
});

describe("template integrity in the database (AC-02-5, AC-03-5)", () => {
  it("rejects a prerequisite cycle", async () => {
    // seed data: landlord_confirmation requires secure_residence
    const residence = await templateId("de.housing.secure_residence");
    const landlord = await templateId("de.housing.landlord_confirmation");
    await expectPgError(
      admin.query("insert into public.template_prerequisites (template_id, prerequisite_template_id, kind) values ($1, $2, 'hard')", [residence, landlord]),
      /prerequisite cycle/,
    );
  });

  it("rejects a needs_review template without an existence source at commit", async () => {
    await admin.query("begin");
    await admin.query(
      "insert into public.task_templates (template_key, category, title, description, region_scope, applicability, verification_status) values ('test.no_source', 'telecom', 't', 'd', 'federal', '{\"all\": []}', 'needs_review')",
    );
    await expectPgError(admin.query("commit"), /requires an existence source/);
  });

  it("rejects marking a template verified while its sources are only AI-fetched (D-10)", async () => {
    await admin.query("begin");
    await admin.query(
      "update public.task_templates set verification_status = 'verified', last_verified_at = current_date where template_key = 'de.registration.address.berlin'",
    );
    await expectPgError(admin.query("commit"), /not reviewed by a human/);
  });

  it("rejects a deadline rule without a deadline source", async () => {
    await admin.query("begin");
    await admin.query(
      `update public.task_templates
          set deadline_rule = '{"anchor": "move_in_date", "offset_days": 30, "source_key": "rundfunkbeitrag.start"}'
        where template_key = 'de.housing.rundfunkbeitrag'`,
    );
    await expectPgError(admin.query("commit"), /not backed by a deadline source/);
  });

  it("rejects source citations with unknown support kinds", async () => {
    const tid = await templateId("de.housing.rundfunkbeitrag");
    const sid = (await admin.query("select id from public.source_documents limit 1")).rows[0].id;
    await expectPgError(
      admin.query("insert into public.template_sources (template_id, source_document_id, supports, excerpt) values ($1, $2, '{opinion}', 'x')", [tid, sid]),
      /template_sources_supports_check/,
    );
  });

  it("stores the seeded Berlin registration deadline backed by its source", async () => {
    const { rows } = await admin.query(
      `select t.deadline_rule, bool_or('deadline' = any (ts.supports)) as has_deadline_source
         from public.task_templates t join public.template_sources ts on ts.template_id = t.id
        where t.template_key = 'de.registration.address.berlin' group by t.deadline_rule`,
    );
    expect(rows[0].deadline_rule).toEqual({ anchor: "move_in_date", offset_days: 14, source_key: "berlin.service.anmeldung" });
    expect(rows[0].has_deadline_source).toBe(true);
  });
});
