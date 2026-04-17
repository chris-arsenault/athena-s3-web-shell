export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  sql: string;
  database?: string;
  workgroup?: string;
}

export interface SaveQueryRequest {
  name: string;
  description?: string;
  sql: string;
  database?: string;
}

export interface SavedQueriesPage {
  items: SavedQuery[];
  nextToken?: string;
}
