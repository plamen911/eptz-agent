import { useEffect, useState } from "react";
import { ApiError, api, token } from "./api";
import { CaseList } from "./screens/CaseList";
import { CaseScreen } from "./screens/CaseScreen";
import { Login } from "./screens/Login";

/** #/ – the cases; #/case/<id> – one case. A hash route works from any static host and offline. */
function useRoute(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

export const go = (path: string) => {
  location.hash = path;
};

export function App() {
  const route = useRoute();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    // a request that needs the key tells whether the stored one still works
    api.cases().then(
      () => setAuthorized(true),
      (e) => setAuthorized(!(e instanceof ApiError && e.status === 401)),
    );
  }, []);

  if (authorized === null) return null;
  if (!authorized) {
    return (
      <Login
        onDone={(key) => {
          token.set(key);
          setAuthorized(true);
        }}
      />
    );
  }

  const caseId = /^\/case\/([\w-]+)$/.exec(route)?.[1];
  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Всички дела">
          ЕПТЗ
        </a>
        {caseId ? (
          <a href="#/" className="back">
            Всички дела
          </a>
        ) : null}
      </header>
      <main>{caseId ? <CaseScreen id={caseId} key={caseId} /> : <CaseList />}</main>
    </div>
  );
}
