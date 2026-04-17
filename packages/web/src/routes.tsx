import { createBrowserRouter, Navigate } from "react-router-dom";

import { App } from "./App";
import { CallbackView } from "./views/auth/CallbackView";
import { QueryView } from "./views/query/QueryView";

export const router = createBrowserRouter([
  // /auth/callback sits OUTSIDE the <App> wrapper so it can complete the
  // OIDC code exchange without triggering AuthProviderProvider's bootstrap
  // (which would redirect to Hosted UI again before the code exchange runs).
  { path: "/auth/callback", element: <CallbackView /> },
  {
    path: "/",
    element: <App />,
    children: [
      // `/workspace` and `/query` both render the consolidated shell —
      // they just seed the corresponding tab kind on mount. `/` is a
      // convenience redirect into the workspace surface.
      { index: true, element: <Navigate to="/workspace" replace /> },
      { path: "workspace", element: <QueryView /> },
      { path: "query", element: <QueryView /> },
    ],
  },
]);
