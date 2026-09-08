/** Validate the JSON Schema subset used by agent tools, including nested bill lines. */
export function validateArgs(tool, args) {
  const errors = [];
  function visit(spec, value, path) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array"
      : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
    const types = Array.isArray(spec.type) ? spec.type : spec.type ? [spec.type] : [];
    if (types.length && !types.includes(actual) && !(types.includes("number") && actual === "integer")) {
      errors.push(`${path} must be ${types.join(" or ")}`);
      return;
    }
    if (spec.enum && !spec.enum.includes(value)) errors.push(`${path} must be one of ${spec.enum.join(", ")}`);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) errors.push(`${path} must be finite`);
      if (spec.minimum !== undefined && value < spec.minimum) errors.push(`${path} must be at least ${spec.minimum}`);
      if (spec.maximum !== undefined && value > spec.maximum) errors.push(`${path} must be at most ${spec.maximum}`);
      if (spec.exclusiveMinimum !== undefined && value <= spec.exclusiveMinimum) errors.push(`${path} must be greater than ${spec.exclusiveMinimum}`);
      if (spec.exclusiveMaximum !== undefined && value >= spec.exclusiveMaximum) errors.push(`${path} must be less than ${spec.exclusiveMaximum}`);
    }
    if (typeof value === "string") {
      if (spec.minLength !== undefined && value.length < spec.minLength) errors.push(`${path} is too short`);
      if (spec.maxLength !== undefined && value.length > spec.maxLength) errors.push(`${path} is too long`);
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) errors.push(`${path} has an invalid format`);
    }
    if (Array.isArray(value)) {
      if (spec.minItems !== undefined && value.length < spec.minItems) errors.push(`${path} needs at least ${spec.minItems} items`);
      if (spec.maxItems !== undefined && value.length > spec.maxItems) errors.push(`${path} allows at most ${spec.maxItems} items`);
      if (spec.items) value.forEach((item, index) => visit(spec.items, item, `${path}[${index}]`));
    } else if (value !== null && typeof value === "object") {
      const properties = spec.properties ?? {};
      for (const key of spec.required ?? []) {
        if (!Object.hasOwn(value, key) || value[key] === undefined || value[key] === null || value[key] === "") {
          errors.push(`${path === "arguments" ? "" : `${path}.`}${key} is required`);
        }
      }
      for (const [key, item] of Object.entries(value)) {
        const childPath = path === "arguments" ? key : `${path}.${key}`;
        if (!Object.hasOwn(properties, key)) {
          if (spec.additionalProperties === false) errors.push(`${childPath} is not a parameter of ${tool.name}`);
        } else {
          visit(properties[key], item, childPath);
        }
      }
    }
  }
  visit(tool.parameters ?? { type: "object" }, args, "arguments");
  return errors;
}
