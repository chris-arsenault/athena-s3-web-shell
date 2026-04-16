export interface DatabaseRef {
  name: string;
  description?: string;
}

export interface TableRef {
  name: string;
  database: string;
  type?: string;
  description?: string;
}

export interface Column {
  name: string;
  type: string;
  comment?: string;
  partitionKey?: boolean;
}

export interface TableDetail extends TableRef {
  columns: Column[];
  partitionKeys: Column[];
  location?: string;
}

export interface Page<T> {
  items: T[];
  nextToken?: string;
}
