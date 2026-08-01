/**
 * Renders an unknown thrown value for a log line without ever throwing itself.
 *
 * `String(value)` is not safe on its own here: a value carrying a throwing
 * `toString` or `Symbol.toPrimitive`, or an `Error` whose `message` is not a
 * string, throws on coercion. Every caller is a catch block whose entire job is
 * to stop a throw escaping, so a formatter that can throw defeats the catch it
 * sits in — which is exactly how the WS dispatch crash came back a second time.
 */
export function describeError(err: unknown): string {
	try {
		if (err instanceof Error && typeof err.message === 'string') return err.message;
		return String(err);
	} catch {
		return '<unrenderable>';
	}
}
