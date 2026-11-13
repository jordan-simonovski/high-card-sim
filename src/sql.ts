// The single audited place where a player-controlled string becomes SQL text.
// Values are bound as ClickHouse query parameters: `SET param_x = '<literal>'` then the
// query uses `{x:Type}`. ClickHouse substitutes the parameter as a typed value, never as
// SQL. The value is unescaped twice, so it is encoded twice:
//   1. as a parameter value, which ClickHouse parses in the escaped (TSV) format;
//   2. as the single-quoted string literal of the SET statement.

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Escape a value for a single-quoted ClickHouse string literal (backslash and quote). */
export function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Escape a value for ClickHouse's escaped (TSV) format, used to parse parameter values. */
export function escapeParamValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export type ParamValue = string | number | boolean;

/** `SET param_*` statements for a parameter map. Throws on unsafe names or non-finite numbers. */
export function paramStatements(params: Record<string, ParamValue>): string[] {
  return Object.entries(params).map(([name, value]) => {
    if (!PARAM_NAME.test(name)) throw new Error(`invalid SQL parameter name: ${JSON.stringify(name)}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`non-finite SQL parameter: ${name}`);
    return `SET param_${name} = ${quoteString(escapeParamValue(String(value)))}`;
  });
}
