import { Router, type Request } from "express";

import { createAthenaClient } from "../aws/athenaClient.js";
import type { ProxyConfig } from "../config.js";
import {
  createSavedQuery,
  deleteSavedQuery,
  listSavedQueries,
} from "../services/savedQueriesService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;
const DESCRIPTION_MAX = 200;
const SQL_MAX = 64_000;

export function savedQueriesRouter(config: ProxyConfig): Router {
  const r = Router();
  const athena = (req: Request) => createAthenaClient(config, req.awsCredentials);

  r.post(
    "/",
    asyncHandler(async (req, res) => {
      const validation = validateSaveBody(req.body);
      if (validation.error) {
        res.status(400).json({ error: { message: validation.error } });
        return;
      }
      const { name, description, sql, database } = validation.value!;
      const out = await createSavedQuery(athena(req), req.user!.athena, {
        name,
        description,
        sql,
        database,
      });
      res.json(out);
    })
  );

  r.get(
    "/",
    asyncHandler(async (req, res) => {
      const page = await listSavedQueries(athena(req), req.user!.athena);
      res.json(page);
    })
  );

  r.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await deleteSavedQuery(athena(req), req.params.id!);
      res.json({ ok: true });
    })
  );

  // Athena has no UpdateNamedQuery — names + SQL are immutable after
  // CreateNamedQuery. Signal that loudly instead of silently no-op'ing.
  r.patch("/:id", (_req, res) => {
    res.status(405).json({
      error: {
        message:
          "Athena named queries are immutable. Delete and re-save to rename.",
      },
    });
  });

  return r;
}

interface ValidatedBody {
  name: string;
  description?: string;
  sql: string;
  database?: string;
}

interface ValidationResult {
  value?: ValidatedBody;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateSaveBody(body: any): ValidationResult {
  if (!body || typeof body !== "object") return { error: "body is required" };
  const name = String(body.name ?? "").trim();
  const sql = String(body.sql ?? "").trim();
  const description = optionalString(body.description);
  const database = optionalString(body.database);

  const err = checkName(name) ?? checkSql(sql) ?? checkDescription(description);
  return err ? { error: err } : { value: { name, description, sql, database } };
}

function optionalString(raw: unknown): string | undefined {
  return raw ? String(raw).trim() : undefined;
}

function checkName(name: string): string | null {
  if (!name || !NAME_PATTERN.test(name)) {
    return "name must be 1-64 chars, letters/digits/space/_/- only";
  }
  return null;
}

function checkSql(sql: string): string | null {
  if (!sql) return "sql is required";
  if (sql.length > SQL_MAX) return "sql exceeds size limit";
  return null;
}

function checkDescription(description: string | undefined): string | null {
  if (description && description.length > DESCRIPTION_MAX) {
    return `description exceeds ${DESCRIPTION_MAX} chars`;
  }
  return null;
}
