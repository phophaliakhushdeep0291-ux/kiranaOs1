/**
 * validate(schema) — middleware that parses and validates req.body against a Zod schema.
 * On success: req.body is replaced with the parsed (typed) data.
 * On failure: passes ZodError to the global error handler.
 */
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(result.error); // ZodError → errorHandler
    }
    req.body = result.data;
    next();
  };
}

/**
 * validateQuery(schema) — same but for req.query
 */
export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(result.error);
    }
    req.query = result.data;
    next();
  };
}
