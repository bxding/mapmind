import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/** Model output is untrusted: allow formatting, never executable HTML. */
export function renderMarkdown(text: string): string {
	return sanitizeHtml(marked.parse(text, { async: false, gfm: true }), {
		allowedTags: ['p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
			'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
		allowedAttributes: { a: ['href', 'title', 'target', 'rel'], ol: ['start'] },
		allowedSchemes: ['https', 'http', 'mailto'],
		allowProtocolRelative: false,
		transformTags: {
			a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' })
		}
	});
}
