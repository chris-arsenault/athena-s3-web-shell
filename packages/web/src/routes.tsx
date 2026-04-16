import { createBrowserRouter, Navigate } from "react-router-dom";

import { App } from "./App";
import { CallbackView } from "./views/auth/CallbackView";
import { WorkspaceView } from "./views/workspace/WorkspaceView";
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
      { index: true, element: <Navigate to="/workspace" replace /> },
      { path: "workspace", element: <WorkspaceView /> },
      { path: "query", element: <QueryView /> },
    ],
  },
]);
