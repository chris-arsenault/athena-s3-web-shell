import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CognitoAuthProvider } from "../../auth/CognitoAuthProvider";
import { provider } from "../../auth/provider";
import { AuthSplash } from "../../components/AuthSplash";

/**
 * /auth/callback — the one-shot landing after Cognito Hosted UI.
 *
 * Race-condition guard: the authorization code in the URL is single-use
 * (Cognito invalidates it on the first /oauth2/token call). If this
 * component's effect fires twice — StrictMode in dev, a re-mount on
 * navigation, whatever — the second attempt posts the same code and
 * Cognito responds 400 invalid_grant. We defend two ways:
 *
 *   1. `handled` ref latches on first entry. Re-entries become no-ops.
 *   2. The code + state are pulled from `window.location` and immediately
 *      stripped via history.replaceState, so even a refresh can't retry.
 */
export function CallbackView() {
  const navigate = useNavigate();
  const [error, setError] = useState<Error | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description") ?? "";

    // Clear the code out of the URL immediately — prevents back/refresh
    // from re-triggering a doomed retry.
    window.history.replaceState({}, "", url.pathname);

    if (errParam) {
      setError(new Error(`Cognito reported: ${errParam} ${errDesc}`.trim()));
      return;
    }
    if (!code || !state) {
      setError(new Error("Missing code or state on /auth/callback"));
      return;
    }
    if (!(provider instanceof CognitoAuthProvider)) {
      setError(new Error("Callback reached but active provider is not Cognito"));
      return;
    }

    provider
      .completeSignIn(code, state)
      .then((returnTo) => navigate(returnTo, { replace: true }))
      .catch(setError);
  }, [navigate]);

  return <AuthSplash message="completing sign-in" error={error} />;
}
