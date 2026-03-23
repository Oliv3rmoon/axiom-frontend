import { NextRequest, NextResponse } from 'next/server';

const API_KEY = 'axiom-search-2026';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const query = req.nextUrl.searchParams.get('q');

  if (key !== API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!query) {
    return NextResponse.json({ error: 'missing q parameter' }, { status: 400 });
  }

  let results: any = null;

  // Method 1: DuckDuckGo Instant Answer API
  try {
    const ddgRes = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { next: { revalidate: 0 } }
    );
    const ddg = await ddgRes.json();
    const parts: string[] = [];
    if (ddg.AbstractText) parts.push(ddg.AbstractText);
    if (ddg.AbstractURL) parts.push(`[Source: ${ddg.AbstractURL}]`);
    if (ddg.RelatedTopics?.length > 0) {
      for (const rt of ddg.RelatedTopics.slice(0, 4)) {
        if (rt.Text) parts.push(rt.Text);
        if (rt.FirstURL) parts.push(`[${rt.FirstURL}]`);
      }
    }
    if (parts.length > 0) {
      results = { source: 'ddg_api', content: parts.join(' | ') };
    }
  } catch (e) {
    console.log('[SEARCH] DDG API failed:', e);
  }

  // Method 2: DuckDuckGo HTML Lite
  if (!results) {
    try {
      const liteRes = await fetch(
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        }
      );
      const html = await liteRes.text();
      const snippets: string[] = [];
      const urls: string[] = [];

      const snippetRegex = /class="result-snippet">([\s\S]*?)<\/td/g;
      let match;
      while ((match = snippetRegex.exec(html)) !== null && snippets.length < 4) {
        const clean = match[1].replace(/<[^>]*>/g, '').trim();
        if (clean.length > 20) snippets.push(clean);
      }

      const urlRegex = /class="result-link"[^>]*href="([^"]+)"/g;
      while ((match = urlRegex.exec(html)) !== null && urls.length < 4) {
        urls.push(match[1]);
      }

      if (snippets.length > 0) {
        results = {
          source: 'ddg_lite',
          content: snippets.map((s, i) => (urls[i] ? `${s} (${urls[i]})` : s)).join(' | '),
          urls,
        };
      }
    } catch (e) {
      console.log('[SEARCH] DDG Lite failed:', e);
    }
  }

  // Method 3: Wikipedia
  if (!results) {
    try {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/ /g, '_'))}`
      );
      if (wikiRes.ok) {
        const wiki = await wikiRes.json();
        if (wiki.extract) {
          results = {
            source: 'wikipedia',
            content: wiki.extract,
            url: wiki.content_urls?.desktop?.page,
          };
        }
      }
    } catch (e) {
      console.log('[SEARCH] Wikipedia failed:', e);
    }
  }

  // Method 4: DuckDuckGo full HTML
  if (!results) {
    try {
      const fullRes = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }
      );
      const html = await fullRes.text();
      const snippets: string[] = [];
      const bodyRegex = /class="result__snippet">([\s\S]*?)<\/a/g;
      let match;
      while ((match = bodyRegex.exec(html)) !== null && snippets.length < 4) {
        const clean = match[1].replace(/<[^>]*>/g, '').trim();
        if (clean.length > 20) snippets.push(clean);
      }
      if (snippets.length > 0) {
        results = { source: 'ddg_html', content: snippets.join(' | ') };
      }
    } catch (e) {
      console.log('[SEARCH] DDG HTML failed:', e);
    }
  }

  if (results) {
    return NextResponse.json({ query, ...results });
  }

  return NextResponse.json({ query, error: 'no results from any source' });
}
