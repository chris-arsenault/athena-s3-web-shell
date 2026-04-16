import {
  GetDatabasesCommand,
  GetTableCommand,
  GetTablesCommand,
  type GlueClient,
} from "@aws-sdk/client-glue";

import type { Column, DatabaseRef, Page, TableDetail, TableRef } from "@athena-shell/shared";

const CATALOG = "AwsDataCatalog";

export async function listDatabases(
  client: GlueClient,
  nextToken?: string
): Promise<Page<DatabaseRef>> {
  const out = await client.send(
    new GetDatabasesCommand({ CatalogId: undefined, NextToken: nextToken })
  );
  return {
    items: (out.DatabaseList ?? []).map((d) => ({
      name: d.Name ?? "",
      description: d.Description,
    })),
    nextToken: out.NextToken,
  };
}

export async function listTables(
  client: GlueClient,
  database: string,
  nextToken?: string
): Promise<Page<TableRef>> {
  const out = await client.send(
    new GetTablesCommand({ DatabaseName: database, NextToken: nextToken })
  );
  return {
    items: (out.TableList ?? []).map((t) => ({
      name: t.Name ?? "",
      database,
      type: t.TableType,
      description: t.Description,
    })),
    nextToken: out.NextToken,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toColumn(c: any, partitionKey = false): Column {
  return {
    name: c.Name ?? "",
    type: c.Type ?? "",
    comment: c.Comment,
    ...(partitionKey ? { partitionKey: true } : {}),
  };
}

export async function getTable(
  client: GlueClient,
  database: string,
  table: string
): Promise<TableDetail> {
  const out = await client.send(
    new GetTableCommand({ DatabaseName: database, Name: table })
  );
  const t = out.Table;
  const sd = t?.StorageDescriptor;
  return {
    name: t?.Name ?? table,
    database,
    type: t?.TableType,
    description: t?.Description,
    columns: (sd?.Columns ?? []).map((c) => toColumn(c)),
    partitionKeys: (t?.PartitionKeys ?? []).map((c) => toColumn(c, true)),
    location: sd?.Location,
  };
}

export const _CATALOG = CATALOG;
