// Placeholder until the UI stage (Week 3+). Shows the design tokens in use.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-medium text-primary">Cross-border Life OS</p>
      <h1 className="text-3xl font-semibold tracking-tight">한국 → 독일 이주, 공식 출처로 확인하며 준비하세요</h1>
      <p className="text-muted-foreground">
        개인별 체크리스트, 선행 조건이 반영된 일정, 공식 출처 기반 안내를 준비 중입니다. 이 서비스는 일반 정보를
        제공하며 법률·세무·비자 자문이 아닙니다.
      </p>
      <div className="rounded-card border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">개발 진행 상황</p>
        <p className="mt-1 font-medium">2주차: 데이터베이스와 출처 데이터 구축</p>
      </div>
    </main>
  );
}
