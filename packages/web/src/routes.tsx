import { createBrowserRouter, Navigate } from "react-router-dom";

import { App } from "./App";
import { WorkspaceView } from "./views/workspace/WorkspaceView";
import { QueryView } from "./views/query/QueryView";

export const router = createBrowserRouter([
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
