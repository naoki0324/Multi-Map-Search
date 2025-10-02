# Multi-Map Search

This repository contains a zero-dependency MVP implementation of the multi-query map search experience outlined below. A lightweight Node.js server serves the static frontend and proxies search requests to the Overpass API so that multiple keyword searches can be visualised on a single Google Maps basemap.

## Getting Started

### Prerequisites

- Node.js 18 or newer (for the built-in `fetch` API and ES2015 features)

### Local development

```bash
npm run dev
```

The command starts the server on [http://localhost:3000](http://localhost:3000). The frontend is compiled as vanilla ES modules, so no bundler step is required. When developing, you can edit the files in `public/` and reload the browser.

### Environment variables

Create a `.env` file at the project root that exposes your Google Maps API key:

``
GOOGLE_MAPS_API_KEY=your-key-here
```

Restart the development server after editing the key so the runtime configuration served at `/config.js` picks up the change.

### Project structure

``
public/
  index.html        # UI layout, Google Maps config injection & Supercluster CDN bindings
  styles.css        # Tailored dark UI with responsive layout
  src/app.js        # Core application logic (state, map, filters, URL sync)
server/
  server.js         # Static file server + Overpass proxy with caching & throttling
```

### Key capabilities implemented

- Up to five concurrent keyword queries, each auto-assigned a unique colour chip.
- Manual “このエリアで再検索” trigger after panning/zooming, with shareable URL state.
- Google Maps JavaScript API basemap with Supercluster-powered clustering and multi-colour ring markers for overlapping POIs.
- Deduplication of points within ±30 m and a detail panel that cycles through stacked results at the same coordinate.
- Filters for “営業中のみ” (powered by the `opening_hours` library) and distance radius in kilometres.
- Backend-for-frontend layer that proxies Overpass API queries, normalises POI metadata, caches responses for 5 minutes, and enforces a small concurrent request cap.

---

# Multi-Map Search MVP Plan

## 1. Goal
Build a mobile-first web application that lets users run up to five different place searches (e.g., `鶴見 × 「ローソン」「銭湯」「スーパー」`) on the same map, visualize the results with distinct colors, and move seamlessly from discovery to action (navigation, sharing) with minimal interaction.

## 2. MVP Scope & Requirements

### Supported Platforms
- Latest two major versions of Chrome, Safari, Edge, and Firefox.
- Responsive layout with a smartphone-first experience.

### Map & Search
- Map SDK: **Mapbox GL JS** (preferred for richer UI) or **Leaflet + MapTiler tiles**.
- Up to 5 simultaneous search queries per session.
- Queries execute against a center point (current location or custom) and within the visible map bounds.
- Data provider (choose one for MVP):
  - **Google Places API** (recommended for accuracy, ratings, hours; paid with display requirements).
  - **Overpass API (OSM)** as a low-cost alternative (limited POI metadata).
- Manual reload via "Search this area" button after pan/zoom (auto reload as a post-MVP enhancement).

### Display & Interaction
- Automatic color/icon assignment per query with a visible legend and layer toggles.
- Cluster markers when zoomed out.
- Pin card details: name, address, opening hours (if available), phone number, quick links to Google/Apple Maps.
- Deduplicate POIs within ±30 m: merge into a single marker with layered rings or a badge count indicating multiple hits.
- Legend updates show active layer counts; toggles hide/show layers.

### Filters & Sorting
- Filters: `openNow`, distance radius (e.g., within N km).
- Sorting: by distance or rating (when available from the provider).

### Save & Share
- Encode map state in the URL: center, zoom, queries (with assigned colors), filters, layer visibility.
- Opening a shared URL reproduces the same map state.

### Error Handling & UX
- User-friendly error messages (e.g., "結果が取得できませんでした") with retry controls.
- Explicit geolocation permission prompt; HTTPS required.

### Performance Targets
- Time-to-Interactive ≤ 2.5 s on first load over 4G (mid-tier smartphone).
- Map re-render after panning ≤ 300 ms.
- Search response (query to rendered markers) ≤ 3 s at p95 in realistic scenarios.

## 3. Screen Flow
1. **Landing** – Query input (comma-separated or tag chips), geolocation prompt, optional manual center input.
2. **Map View** – Scrollable legend chips, "Search this area" CTA, current location button (bottom-right).
3. **Pin Details** – Marker tap opens a card with action buttons for external navigation or phone dial.
4. **Share** – Copyable URL reflecting the current map state.

## 4. URL Schema (example)
```
/m?c=35.5089,139.6792&z=13&q=ローソン:red,銭湯:blue,スーパー:green&f=openNow:true,radius:2000&v=lawson:true,sento:true,super:true
```
- `c`: Center latitude/longitude.
- `z`: Zoom level.
- `q`: `query:color` entries.
- `f`: Filters.
- `v`: Visibility flags per layer.

## 5. Frontend Data Model
```ts
interface MapState {
  center: [number, number];
  zoom: number;
  queries: QueryLayer[];
  filters: Filters;
  visibleLayers: Record<string, boolean>;
}

interface QueryLayer {
  id: string;
  label: string;
  color: string;
  bbox: [number, number, number, number]; // swLng, swLat, neLng, neLat
  items: POI[];
}

interface POI {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  sourceId: string;
  categories?: string[];
  rating?: number;
  openNow?: boolean;
  phone?: string;
}
```

## 6. Backend / BFF Responsibilities
- Hide API keys, normalize results, throttle request volume, and provide short-term caching (≈5 minutes).
- Suggested endpoints:
  - `GET /search?bbox=<bbox>&q=<query>` → normalized POI array.
  - `GET /places?ids=<comma-separated>` → enriched details when the card opens.
- Cache key strategy: `provider + bbox + query`.
- Rate limiting: debounce search inputs (~600 ms) and enforce max concurrent requests (e.g., 5).

## 7. Technology Choices
- Frontend: **React** with **Vite** or **Next.js** (SSG-friendly).
- Styling: **Tailwind CSS** or CSS Modules.
- Map: **Mapbox GL JS** (primary) or **Leaflet** fallback.
- Hosting: **Vercel** or **Netlify**.
- Monitoring: Vercel Analytics, Sentry for errors, `web-vitals` for performance.

## 8. Delivery Criteria
- Render 3+ queries simultaneously with distinct colors.
- Legend toggles update visibility and counts accordingly.
- Co-located POIs merge with a composite marker; the detail card allows cycling through overlapped entries.
- Shared URLs restore full state on load.
- Achieve sub-3-second search-to-render on 4G (p95).

## 9. Post-MVP Roadmap
- Automatic re-query on map move.
- Enhanced pin list sorting, favorites (local or anonymous ID).
- CSV/GeoJSON export (lower priority for general users).
- PWA support, multi-stop routing, visit notes, calendar integration.
- Layers for reviews, crowding, isochrones.
- Social sharing with generated OG images.

## 10. Implementation Milestones
1. **Foundation** – Project scaffolding, map rendering, geolocation, and responsive layout.
2. **Query Engine** – Multi-query input, API integration (BFF + provider), dedupe logic.
3. **Visualization** – Color assignment, clustering, legend toggles, marker cards with actions.
4. **State Management** – URL encoding/decoding, filter persistence, error handling.
5. **Optimization & QA** – Performance tuning, accessibility pass, analytics & monitoring hooks.

## 11. Testing & Quality
- Unit tests for utility functions (URL encoder/decoder, dedupe).
- Integration tests for BFF endpoints (with mocked provider responses).
- E2E smoke tests (Playwright/Cypress) covering query flow, pin interaction, sharing.
- Performance budgets monitored via Lighthouse CI on representative devices.

## 12. Risk & Mitigation Notes
- **API Cost**: Monitor Google Places usage; set quotas and alerts.
- **Rate Limits**: Implement caching/backoff, show friendly errors if provider throttles.
- **Data Quality**: Provide fallback when hours/rating unavailable (display "情報なし").
- **Privacy**: Ensure geolocation consent and secure handling of analytics data.

## 13. Rough Effort Estimate
- MVP design + implementation: 3–5 person-weeks assuming one data provider and existing UI library.
- Operating cost: Map tiles + Places API consumption (likely within free tier initially; scales to several thousand JPY/month depending on usage).

