/** Reports invalid user input and conflicts without an internal stack trace. */
export class ScaffoldInputError extends Error {}

/** Reports generation, parsing, writing, or verification failures. */
export class ScaffoldExecutionError extends Error {}
