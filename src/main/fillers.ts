// Filler / mixed episodes from animefillerlist.com (no API: the show page's episode table is read).
// The show is found by turning the anime's titles into the site's URL slugs.

type Fillers = { filler: number[]; mixed: number[]; slug: string }
const cache = new Map<string, Promise<Fillers | null>>()

const slugify = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'":!?.,()[\]]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

function candidates(titles: string[]): string[] {
  const out: string[] = []
  for (const t of titles.filter(Boolean)) {
    const s = slugify(t)
    // Only the exact title: a sequel must not get the first season's filler list.
    out.push(s)
  }
  return [...new Set(out)].filter(s => s.length > 1).slice(0, 5)
}

async function fetchShow(slug: string): Promise<Fillers | null> {
  const res = await fetch('https://www.animefillerlist.com/shows/' + slug, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!res.ok) return null
  const html = await res.text()
  const filler: number[] = []
  const mixed: number[] = []
  let rows = 0
  for (const m of html.matchAll(/<tr class="([^"]+)"[^>]*id="eps-(\d+)"/g)) {
    rows++
    const n = Number(m[2])
    if (/mixed/.test(m[1])) mixed.push(n)
    else if (/\bfiller\b/.test(m[1])) filler.push(n)
  }
  return rows ? { filler, mixed, slug } : null
}

export function fillers(titles: string[]): Promise<Fillers | null> {
  const key = titles.join('|')
  if (!cache.has(key)) {
    const job = (async () => {
      for (const slug of candidates(titles)) {
        const r = await fetchShow(slug).catch(() => null)
        if (r) return r
      }
      return null
    })()
    cache.set(key, job)
  }
  return cache.get(key)!
}
