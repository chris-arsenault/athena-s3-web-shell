import path from "node:path";
import express, { type Express } from "express";

export function mountSpa(app: Express, staticDir: string): void {
  const root = path.resolve(staticDir);
  app.use(express.static(root, { index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(root, "index.html"));
  });
}
