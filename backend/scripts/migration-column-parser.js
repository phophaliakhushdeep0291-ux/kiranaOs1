function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function collectAlterTableAddedColumns(migrationText, tableName) {
  const columns = new Set();
  const escapedTable = escapeRegExp(tableName);
  const alterBlock = new RegExp(`ALTER\\s+TABLE\\s+"${escapedTable}"\\s+([\\s\\S]*?);`, "gi");
  let blockMatch;
  while ((blockMatch = alterBlock.exec(migrationText)) !== null) {
    const addColumn = /(?:^|,)\s*ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"(\w+)"/gim;
    let columnMatch;
    while ((columnMatch = addColumn.exec(blockMatch[1])) !== null) columns.add(columnMatch[1]);
  }
  return columns;
}