/*
 * Tool: xray_suggest_sni_for_country
 *
 * Curated REALITY SNI/target hosts per exit-node country. Pure data —
 * no network calls. The list is hand-picked from sites known to:
 *   - Run TLS 1.3 + ALPN h2 (REALITY requirement on the target).
 *   - Be popular/legitimate enough that DPI middleboxes treat the
 *     traffic as benign.
 *   - NOT advertise themselves as VPN/proxy services.
 *
 * Pair the result with `xray_validate_sni_target` for a live
 * handshake check before committing a host into a config.
 */

export interface SuggestSniArgs {
  country_code?: string;
  max_results?: number;
}

export interface SniCandidate {
  host: string;
  rationale: string;
  avoid_if?: string;
}

export interface SuggestSniResult {
  country: string;
  candidates: SniCandidate[];
  generic_safe: string[];
}

const CATALOGUE: Record<string, SniCandidate[]> = {
  DE: [
    { host: "www.bahn.de", rationale: "Deutsche Bahn — national rail. TLS 1.3 + h2, huge user base, German DPI ignores it as government-adjacent infra." },
    { host: "www.tagesschau.de", rationale: "Public broadcaster news. TLS 1.3 + h2, massive DE traffic, no proxy reputation." },
    { host: "www.spiegel.de", rationale: "Major news magazine. TLS 1.3 + h2, mainstream, low scrutiny." },
    { host: "www.zeit.de", rationale: "Top-tier German weekly newspaper. TLS 1.3 + h2, legitimate front." },
    { host: "www.kicker.de", rationale: "Football news portal — high-volume, TLS 1.3 + h2, neutral." },
    { host: "www.dw.com", rationale: "Deutsche Welle — international broadcaster. TLS 1.3 + h2.", avoid_if: "Russia exit user (DW is RKN-blocked, target reachability from RU clients matters less for REALITY but the SNI may attract attention)." },
  ],
  PL: [
    { host: "www.onet.pl", rationale: "Top-3 Polish portal. TLS 1.3 + h2, neutral country, NOT a VPN provider — Russian DPI passes it through cleanly." },
    { host: "www.allegro.pl", rationale: "Largest PL e-commerce. TLS 1.3 + h2, huge legit traffic from RU/EU clients." },
    { host: "www.wp.pl", rationale: "Major PL portal. TLS 1.3 + h2, mainstream news + mail." },
    { host: "www.interia.pl", rationale: "Polish news portal, TLS 1.3 + h2, legitimate." },
    { host: "wyborcza.pl", rationale: "Top Polish daily newspaper, TLS 1.3 + h2." },
  ],
  NL: [
    { host: "www.kpn.com", rationale: "Dutch incumbent telco. TLS 1.3 + h2, very low scrutiny." },
    { host: "www.ad.nl", rationale: "Algemeen Dagblad — national newspaper. TLS 1.3 + h2." },
    { host: "www.nu.nl", rationale: "Top Dutch news portal. TLS 1.3 + h2." },
    { host: "www.philips.com", rationale: "Multinational, NL HQ. TLS 1.3 + h2, corporate traffic." },
    { host: "www.bol.com", rationale: "Largest NL e-commerce.", avoid_if: "Reported as flaky from RU vantage in late 2025 — verify with xray_validate_sni_target from a РФ IP first." },
  ],
  FR: [
    { host: "www.leboncoin.fr", rationale: "Largest FR classifieds. TLS 1.3 + h2, massive traffic." },
    { host: "www.lemonde.fr", rationale: "Le Monde — newspaper of record. TLS 1.3 + h2." },
    { host: "www.orange.fr", rationale: "Incumbent telco portal. TLS 1.3 + h2, legitimate." },
    { host: "www.lefigaro.fr", rationale: "Le Figaro — major daily. TLS 1.3 + h2." },
  ],
  LV: [
    { host: "www.lsm.lv", rationale: "Latvian public media. TLS 1.3 + h2, neutral country." },
    { host: "www.ss.lv", rationale: "Top LV classifieds. TLS 1.3 + h2, very high local traffic." },
    { host: "www.delfi.lv", rationale: "Latvian Delfi — news portal. TLS 1.3 + h2." },
  ],
  SE: [
    { host: "www.svt.se", rationale: "Swedish public TV. TLS 1.3 + h2." },
    { host: "www.dn.se", rationale: "Dagens Nyheter — major newspaper. TLS 1.3 + h2." },
    { host: "www.aftonbladet.se", rationale: "Top SE tabloid. TLS 1.3 + h2, huge traffic." },
  ],
  FI: [
    { host: "www.yle.fi", rationale: "Finnish public broadcaster. TLS 1.3 + h2." },
    { host: "www.hs.fi", rationale: "Helsingin Sanomat — major newspaper. TLS 1.3 + h2." },
    { host: "www.iltalehti.fi", rationale: "Top FI tabloid. TLS 1.3 + h2." },
  ],
  US: [
    { host: "www.cloudflare.com", rationale: "Worldwide-popular CDN front. TLS 1.3 + h2, anycast — no geo signal in IP." },
    { host: "www.jsdelivr.net", rationale: "Free CDN, very high request volume. TLS 1.3 + h2." },
    { host: "www.fastly.net", rationale: "Major CDN. TLS 1.3 + h2." },
    { host: "store.steampowered.com", rationale: "Steam storefront. TLS 1.3 + h2, gamer traffic ignored by RU DPI." },
    { host: "www.microsoft.com", rationale: "Microsoft global. TLS 1.3 + h2.", avoid_if: "Frequent REALITY probe target — high public scrutiny." },
  ],
  GB: [
    { host: "www.bbc.co.uk", rationale: "BBC — top UK media. TLS 1.3 + h2." },
    { host: "www.theguardian.com", rationale: "Major UK newspaper. TLS 1.3 + h2." },
    { host: "www.sky.com", rationale: "Sky UK — telco/media. TLS 1.3 + h2." },
  ],
  UK: [
    /* alias */
    { host: "www.bbc.co.uk", rationale: "BBC — top UK media. TLS 1.3 + h2." },
    { host: "www.theguardian.com", rationale: "Major UK newspaper. TLS 1.3 + h2." },
    { host: "www.sky.com", rationale: "Sky UK — telco/media. TLS 1.3 + h2." },
  ],
  JP: [
    { host: "www.nicovideo.jp", rationale: "Niconico — top JP video site. TLS 1.3 + h2." },
    { host: "www.asahi.com", rationale: "Asahi Shimbun — major newspaper. TLS 1.3 + h2." },
  ],
  SG: [
    { host: "www.straitstimes.com", rationale: "The Straits Times — main SG newspaper. TLS 1.3 + h2." },
    { host: "www.channelnewsasia.com", rationale: "CNA — regional news. TLS 1.3 + h2." },
  ],
  AU: [
    { host: "www.abc.net.au", rationale: "ABC — public broadcaster. TLS 1.3 + h2." },
    { host: "www.news.com.au", rationale: "News.com.au — top AU news. TLS 1.3 + h2." },
  ],
  CA: [
    { host: "www.cbc.ca", rationale: "CBC — public broadcaster. TLS 1.3 + h2." },
  ],
};

const COUNTRY_NAMES: Record<string, string> = {
  DE: "Germany", PL: "Poland", NL: "Netherlands", FR: "France",
  LV: "Latvia", SE: "Sweden", FI: "Finland", US: "United States",
  GB: "United Kingdom", UK: "United Kingdom", JP: "Japan", SG: "Singapore",
  AU: "Australia", CA: "Canada",
};

const GENERIC_SAFE: string[] = [
  "www.cloudflare.com",
  "www.jsdelivr.net",
  "www.fastly.net",
  "www.microsoft.com", /* probe-target risk noted in catalogue entry */
];

export function suggestSniForCountry(args: SuggestSniArgs): SuggestSniResult {
  const raw = (args.country_code ?? "").trim().toUpperCase();
  if (!raw) throw new Error("Missing required parameter: country_code (ISO 2-letter)");
  const max = Math.max(1, Math.min(20, args.max_results ?? 5));

  const list = CATALOGUE[raw] ?? [];
  const country = COUNTRY_NAMES[raw] ?? raw;

  return {
    country,
    candidates: list.slice(0, max),
    generic_safe: GENERIC_SAFE,
  };
}

export function listSupportedCountries(): string[] {
  return Object.keys(CATALOGUE).sort();
}
