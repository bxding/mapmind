import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('assistant Markdown', () => {
	it('renders emphasis, headings, lists, and paragraphs', () => {
		const html = renderMarkdown('## Nearby cafés\n\n**Coffee** and *tea*.\n\n- First\n- Second\n\n1. Visit\n2. Enjoy');
		expect(html).toContain('<h2>Nearby cafés</h2>');
		expect(html).toContain('<strong>Coffee</strong>');
		expect(html).toContain('<em>tea</em>');
		expect(html).toContain('<ul>'); expect(html).toContain('<ol>');
	});
	it('renders fenced code as text and supports tables', () => {
		const html = renderMarkdown('`amenity=cafe`\n\n```html\n<script>alert(1)</script>\n```\n\n| Place | Count |\n| --- | --- |\n| Café | 2 |');
		expect(html).toContain('<code>amenity=cafe</code>');
		expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
		expect(html).toContain('<table>'); expect(html).toContain('<td>Café</td>');
	});
	it('keeps safe links while removing dangerous URLs and executable HTML', () => {
		const html = renderMarkdown('[Map](https://www.openstreetmap.org)\n\n[Bad](javascript:alert%281%29)\n\n<script>alert(1)</script><img src=x onerror=alert(1)><a href="java&#115;cript:alert(1)" onclick="alert(1)">Bad</a><iframe src="https://example.com"></iframe>');
		expect(html).toContain('href="https://www.openstreetmap.org"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).not.toMatch(/javascript:|onclick|onerror|<script|<img|<iframe/);
	});
});
