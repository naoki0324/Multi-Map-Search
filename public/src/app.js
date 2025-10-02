const colorPalette = ['#f97316', '#38bdf8', '#34d399', '#f472b6', '#c084fc', '#facc15', '#fb7185'];

const defaultState = {
  center: { lat: 35.681236, lng: 139.767125 },
  zoom: 12,
  queries: [],
  filters: { openNow: false, radius: null },
  visible: [],
};

const state = structuredClone(defaultState);
const queryResults = new Map();
let map = null;
let mapReady = false;
let clusterIndex = null;
let markers = [];
let needsSearch = false;
let searchCenter = null;
let searchZoom = null;
let detailContext = null;
let googleMapsPromise = null;
let googleMaps = null;

const mapContainer = document.getElementById('map');
const queryForm = document.getElementById('query-form');
const queryInput = document.getElementById('query-input');
const queryChips = document.getElementById('query-chips');
const legendContainer = document.getElementById('legend-items');
const searchAreaBtn = document.getElementById('search-area-btn');
const toastEl = document.getElementById('toast');
const filterOpenNow = document.getElementById('filter-open-now');
const filterRadius = document.getElementById('filter-radius');
const applyFiltersBtn = document.getElementById('apply-filters');
const resetFiltersBtn = document.getElementById('reset-filters');
const locateBtn = document.getElementById('locate-btn');

const detailPanel = document.getElementById('detail-panel');
const detailBadges = document.getElementById('detail-badges');
const detailCloseBtn = document.getElementById('detail-close');
const detailTitle = document.getElementById('detail-title');
const detailAddress = document.getElementById('detail-address');
const detailStatus = document.getElementById('detail-status');
const detailMeta = document.getElementById('detail-meta');
const detailPrev = document.getElementById('detail-prev');
const detailNext = document.getElementById('detail-next');
const detailNav = document.getElementById('detail-nav');
const detailIndex = document.getElementById('detail-index');
const detailOpenGoogle = document.getElementById('detail-open-google');
const detailOpenApple = document.getElementById('detail-open-apple');
const appConfig = window.APP_CONFIG || {};

function structuredClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadGoogleMaps(apiKey) {
  if (googleMapsPromise) {
    return googleMapsPromise;
  }
  if (window.google && window.google.maps) {
    googleMaps = window.google.maps;
    return Promise.resolve(window.google.maps);
  }
  if (!apiKey) {
    return Promise.reject(new Error('Missing Google Maps API key'));
  }
  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({ key: apiKey, libraries: 'marker' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && window.google.maps) {
        googleMaps = window.google.maps;
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps API failed to load'));
      }
    };
    script.onerror = () => reject(new Error('Google Maps script failed to load'));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function getMapCenterLiteral() {
  if (!map) {
    return null;
  }
  const center = map.getCenter();
  if (!center) {
    return null;
  }
  if (typeof center.lat === 'function') {
    return { lat: center.lat(), lng: center.lng() };
  }
  return { lat: center.lat, lng: center.lng };
}

function getBoundsArray(bounds) {
  if (!bounds) {
    return null;
  }
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  if (!southWest || !northEast) {
    return null;
  }
  return [southWest.lng(), southWest.lat(), northEast.lng(), northEast.lat()];
}

function slugify(label) {
  return label
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'query';
}

function showToast(message, duration = 2600) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  setTimeout(() => {
    toastEl.hidden = true;
  }, duration);
}

function pickColor(existingColors) {
  for (const color of colorPalette) {
    if (!existingColors.has(color)) {
      return color;
    }
  }
  return colorPalette[Math.floor(Math.random() * colorPalette.length)];
}

function addQuery(label, color) {
  const trimmed = label.trim();
  if (!trimmed) {
    return;
  }
  if (state.queries.length >= 5) {
    showToast('クエリは最大5件までです');
    return;
  }
  const exists = state.queries.some((q) => q.label === trimmed);
  if (exists) {
    showToast('同じクエリが既に存在します');
    return;
  }
  const colorsInUse = new Set(state.queries.map((q) => q.color));
  const generatedId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const query = {
    id: generatedId,
    key: slugify(trimmed),
    label: trimmed,
    color: color || pickColor(colorsInUse),
    enabled: true,
  };
  state.queries.push(query);
  queryResults.delete(query.id);
  renderQueryChips();
  renderLegend();
  updateSearchButtonState();
  updateUrlState();
}

function removeQuery(id) {
  const index = state.queries.findIndex((q) => q.id === id);
  if (index === -1) return;
  state.queries.splice(index, 1);
  queryResults.delete(id);
  renderQueryChips();
  renderLegend();
  applyFiltersAndRender();
  updateSearchButtonState();
  updateUrlState();
}

function renderQueryChips() {
  queryChips.innerHTML = '';
  state.queries.forEach((query) => {
    const chip = document.createElement('div');
    chip.className = 'query-chip';
    const colorEl = document.createElement('span');
    colorEl.className = 'query-color';
    colorEl.style.background = query.color;
    chip.appendChild(colorEl);

    const labelEl = document.createElement('span');
    labelEl.textContent = query.label;
    chip.appendChild(labelEl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => removeQuery(query.id));
    chip.appendChild(removeBtn);

    queryChips.appendChild(chip);
  });
}

function renderLegend(counts = {}) {
  legendContainer.innerHTML = '';
  state.queries.forEach((query, index) => {
    const count = counts[query.id] || 0;
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.dataset.enabled = String(query.enabled);
    item.dataset.queryId = query.id;

    const left = document.createElement('div');
    left.className = 'legend-left';

    const color = document.createElement('span');
    color.className = 'legend-color';
    color.style.background = query.color;
    left.appendChild(color);

    const textWrap = document.createElement('div');
    const label = document.createElement('div');
    label.textContent = query.label;
    const counter = document.createElement('div');
    counter.textContent = `${count}件`;
    counter.style.color = 'var(--muted)';
    counter.style.fontSize = '0.85rem';
    textWrap.append(label, counter);
    left.appendChild(textWrap);

    const toggle = document.createElement('div');
    toggle.className = 'legend-toggle';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', query.enabled ? 'true' : 'false');
    toggle.tabIndex = 0;

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleQuery(query.id);
    });
    toggle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleQuery(query.id);
      }
    });

    item.append(left, toggle);
    legendContainer.appendChild(item);
  });
}

function toggleQuery(id) {
  const query = state.queries.find((q) => q.id === id);
  if (!query) return;
  query.enabled = !query.enabled;
  renderLegend(currentCounts);
  applyFiltersAndRender();
  updateUrlState();
}

const currentCounts = {};

function updateSearchButtonState() {
  searchAreaBtn.disabled = !mapReady || state.queries.length === 0;
}

function parseInitialState() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('c')) {
    const [latStr, lngStr] = params.get('c').split(',');
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      state.center = { lat, lng };
    }
  }
  if (params.has('z')) {
    const zoom = parseFloat(params.get('z'));
    if (!Number.isNaN(zoom)) {
      state.zoom = zoom;
    }
  }
  if (params.has('f')) {
    const parts = params.get('f').split(',');
    parts.forEach((part) => {
      const [key, value] = part.split(':');
      if (key === 'openNow') {
        state.filters.openNow = value === 'true';
      }
      if (key === 'radius') {
        const radius = parseFloat(value);
        if (!Number.isNaN(radius)) {
          state.filters.radius = radius;
        }
      }
    });
  }
  if (params.has('q')) {
    const entries = params.get('q').split(',');
    entries.forEach((entry) => {
      const [labelPart, colorPart] = entry.split(':');
      if (!labelPart) return;
      const label = decodeURIComponent(labelPart);
      const color = colorPart ? decodeURIComponent(colorPart) : undefined;
      addQuery(label, color);
    });
  }
  if (params.has('v')) {
    const visibilityEntries = params.get('v').split(',');
    visibilityEntries.forEach((entry) => {
      const [idxStr, value] = entry.split(':');
      const idx = parseInt(idxStr, 10);
      if (!Number.isNaN(idx) && state.queries[idx]) {
        state.queries[idx].enabled = value !== 'false';
      }
    });
  }

  filterOpenNow.checked = state.filters.openNow;
  if (state.filters.radius != null) {
    filterRadius.value = state.filters.radius;
  }
}

function updateUrlState() {
  if (!map) return;
  const params = new URLSearchParams();
  const center = getMapCenterLiteral();
  if (center) {
    params.set('c', `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`);
  }
  const zoom = map.getZoom();
  if (typeof zoom === 'number') {
    params.set('z', zoom.toFixed(2));
  }
  if (state.queries.length > 0) {
    const queryParam = state.queries
      .map((q) => `${encodeURIComponent(q.label)}:${encodeURIComponent(q.color)}`)
      .join(',');
    params.set('q', queryParam);
    const visibility = state.queries
      .map((q, index) => `${index}:${q.enabled ? 'true' : 'false'}`)
      .join(',');
    params.set('v', visibility);
  }
  const filterParts = [];
  if (state.filters.openNow) {
    filterParts.push('openNow:true');
  }
  if (state.filters.radius != null && state.filters.radius !== '') {
    filterParts.push(`radius:${state.filters.radius}`);
  }
  if (filterParts.length > 0) {
    params.set('f', filterParts.join(','));
  }
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', url);
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function dedupePois(pois) {
  const groups = [];
  const thresholdKm = 0.03; // 30m
  pois.forEach((poi) => {
    let group = groups.find((g) => haversine(g.lat, g.lng, poi.lat, poi.lng) <= thresholdKm);
    if (!group) {
      group = {
        lat: poi.lat,
        lng: poi.lng,
        items: [],
        colors: new Set(),
      };
      groups.push(group);
    }
    group.items.push(poi);
    group.colors.add(poi.color);
  });
  return groups.map((group) => ({
    lat: group.lat,
    lng: group.lng,
    items: group.items,
    colors: Array.from(group.colors),
  }));
}

function computeOpenNow(poi) {
  if (!poi.openingHours) {
    return null;
  }
  if (typeof window.opening_hours === 'undefined') {
    return null;
  }
  try {
    const oh = new window.opening_hours(poi.openingHours);
    return oh.getState();
  } catch (error) {
    return null;
  }
}

function decoratePoi(poi) {
  if (typeof poi.openNow === 'boolean' || poi.openNow === null) {
    poi.computedOpenNow = poi.openNow;
  } else {
    poi.computedOpenNow = computeOpenNow(poi);
  }
  return poi;
}

function applyFiltersAndRender() {
  const activeQueries = state.queries.filter((q) => q.enabled);
  const filterOpen = state.filters.openNow;
  const radiusKm = state.filters.radius != null && state.filters.radius !== '' ? Number(state.filters.radius) : null;
  const baseCenter =
    searchCenter ||
    getMapCenterLiteral() ||
    { lat: state.center.lat, lng: state.center.lng };
  const filtered = [];
  const counts = {};

  activeQueries.forEach((query) => {
    const items = queryResults.get(query.id) || [];
    items.forEach((poi) => {
      const decorated = decoratePoi({ ...poi });
      if (filterOpen && decorated.computedOpenNow === false) {
        return;
      }
      if (radiusKm != null) {
        const distance = haversine(baseCenter.lat, baseCenter.lng, decorated.lat, decorated.lng);
        if (distance > radiusKm) {
          return;
        }
        decorated.distance = distance;
      }
      filtered.push({ ...decorated, queryId: query.id, color: query.color });
      counts[query.id] = (counts[query.id] || 0) + 1;
    });
  });

  state.queries.forEach((query) => {
    if (!counts[query.id]) {
      counts[query.id] = 0;
    }
  });
  Object.keys(currentCounts).forEach((key) => {
    delete currentCounts[key];
  });
  Object.assign(currentCounts, counts);
  renderLegend(counts);

  const deduped = dedupePois(filtered);
  buildClusters(deduped);
  renderMarkers();
}

function buildClusters(groups) {
  if (!window.Supercluster) {
    return;
  }
  clusterIndex = new window.Supercluster({
    radius: 70,
    maxZoom: 18,
    minPoints: 2,
  });
  const features = groups.map((group, idx) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [group.lng, group.lat] },
    properties: {
      cluster: false,
      id: `group-${idx}`,
      items: group.items,
      colors: group.colors,
    },
  }));
  clusterIndex.load(features);
}

function createMarker(position, element, options = {}) {
  const { onActivate, colors = [] } = options;
  let marker;
  if (
    googleMaps &&
    googleMaps.marker &&
    typeof googleMaps.marker.AdvancedMarkerElement === 'function'
  ) {
    element.style.cursor = 'pointer';
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    marker = new googleMaps.marker.AdvancedMarkerElement({
      map,
      position,
      content: element,
    });
    if (onActivate) {
      element.addEventListener('click', onActivate);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      });
    }
  } else if (googleMaps) {
    const color = colors[0] || '#3b82f6';
    marker = new googleMaps.Marker({
      map,
      position,
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
    });
    if (onActivate) {
      marker.addListener('click', onActivate);
    }
  }
  return marker;
}

function clearMarkers() {
  markers.forEach((marker) => {
    if (!marker) return;
    if (typeof marker.setMap === 'function') {
      marker.setMap(null);
    } else if ('map' in marker) {
      marker.map = null;
    }
  });
  markers = [];
}

function renderMarkers() {
  if (!clusterIndex || !map) {
    clearMarkers();
    return;
  }
  const boundsArray = getBoundsArray(map.getBounds());
  if (!boundsArray) {
    clearMarkers();
    return;
  }
  const zoom = Math.floor(map.getZoom());
  const clusters = clusterIndex.getClusters(boundsArray, zoom);
  clearMarkers();
  clusters.forEach((feature) => {
    const { coordinates } = feature.geometry;
    const [lng, lat] = coordinates;
    const markerEl = document.createElement('div');
    if (feature.properties.cluster) {
      markerEl.className = 'cluster-marker';
      markerEl.textContent = feature.properties.point_count_abbreviated;
      markerEl.setAttribute(
        'aria-label',
        `${feature.properties.point_count}件のスポットをズームして表示`
      );
      const clusterId = feature.id ?? feature.properties.cluster_id;
      const activate = () => {
        const expansionZoom = Math.min(clusterIndex.getClusterExpansionZoom(clusterId), 20);
        map.panTo({ lat, lng });
        map.setZoom(expansionZoom);
      };
      const marker = createMarker({ lat, lng }, markerEl, {
        onActivate: activate,
        colors: feature.properties.colors || [],
      });
      if (marker) {
        markers.push(marker);
      }
    } else {
      markerEl.className = 'marker';
      const colors = feature.properties.colors;
      markerEl.dataset.multi = colors.length > 1 ? 'true' : 'false';
      if (colors.length === 1) {
        markerEl.style.background = colors[0];
      } else {
        const segments = colors
          .map((color, idx) => {
            const start = (idx / colors.length) * 100;
            const end = ((idx + 1) / colors.length) * 100;
            return `${color} ${start}% ${end}%`;
          })
          .join(', ');
        markerEl.style.background = `conic-gradient(${segments})`;
      }
      markerEl.setAttribute('aria-label', `${feature.properties.items.length}件の詳細を開く`);
      const activate = () => {
        openDetail(feature.properties.items, { lat, lng });
      };
      const marker = createMarker({ lat, lng }, markerEl, { onActivate: activate, colors });
      if (marker) {
        markers.push(marker);
      }
    }
  });
}

function openDetail(items, coordinate) {
  if (!items || items.length === 0) {
    return;
  }
  detailContext = { items, index: 0, coordinate };
  updateDetailPanel();
  detailPanel.hidden = false;
}

function updateDetailPanel() {
  if (!detailContext) return;
  const { items, index } = detailContext;
  const current = items[index];
  if (!current) return;

  detailBadges.innerHTML = '';
  const uniqueQueries = new Map();
  items.forEach((item) => {
    if (!uniqueQueries.has(item.queryId)) {
      const query = state.queries.find((q) => q.id === item.queryId);
      if (query) {
        uniqueQueries.set(item.queryId, query);
      }
    }
  });
  uniqueQueries.forEach((query) => {
    const badge = document.createElement('span');
    badge.className = 'detail-badge';
    const swatch = document.createElement('span');
    swatch.className = 'query-color';
    swatch.style.background = query.color;
    swatch.style.width = '12px';
    swatch.style.height = '12px';
    badge.appendChild(swatch);
    const text = document.createElement('span');
    text.textContent = query.label;
    badge.appendChild(text);
    detailBadges.appendChild(badge);
  });

  detailTitle.textContent = current.name || '名称不明';
  detailAddress.textContent = current.address || '住所情報なし';

  const openNow = decoratePoi(current).computedOpenNow;
  if (openNow === true) {
    detailStatus.textContent = '営業中';
    detailStatus.style.color = '#34d399';
  } else if (openNow === false) {
    detailStatus.textContent = '営業時間外';
    detailStatus.style.color = '#f97316';
  } else {
    detailStatus.textContent = '営業時間情報なし';
    detailStatus.style.color = 'var(--muted)';
  }

  detailMeta.innerHTML = '';
  if (current.openingHours) {
    const li = document.createElement('li');
    li.textContent = `営業時間: ${current.openingHours}`;
    detailMeta.appendChild(li);
  }
  if (current.phone) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `tel:${current.phone}`;
    link.textContent = current.phone;
    link.style.color = 'inherit';
    link.style.textDecoration = 'none';
    li.textContent = '電話: ';
    li.appendChild(link);
    detailMeta.appendChild(li);
  }
  if (current.website) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = current.website;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = current.website;
    link.style.color = 'inherit';
    li.textContent = 'Web: ';
    li.appendChild(link);
    detailMeta.appendChild(li);
  }
  if (current.categories && current.categories.length > 0) {
    const li = document.createElement('li');
    li.textContent = `カテゴリ: ${current.categories.join(', ')}`;
    detailMeta.appendChild(li);
  }
  if (current.distance != null) {
    const li = document.createElement('li');
    li.textContent = `距離: 約${current.distance.toFixed(2)} km`;
    detailMeta.appendChild(li);
  }

  if (items.length > 1) {
    detailNav.hidden = false;
    detailIndex.textContent = `${index + 1} / ${items.length}`;
  } else {
    detailNav.hidden = true;
  }

  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${current.lat},${current.lng}`;
  const appleUrl = `https://maps.apple.com/?ll=${current.lat},${current.lng}&q=${encodeURIComponent(
    current.name || 'POI'
  )}`;
  detailOpenGoogle.href = googleUrl;
  detailOpenApple.href = appleUrl;
}

function closeDetail() {
  detailPanel.hidden = true;
  detailContext = null;
}

detailPrev.addEventListener('click', () => {
  if (!detailContext) return;
  detailContext.index = (detailContext.index - 1 + detailContext.items.length) % detailContext.items.length;
  updateDetailPanel();
});

detailNext.addEventListener('click', () => {
  if (!detailContext) return;
  detailContext.index = (detailContext.index + 1) % detailContext.items.length;
  updateDetailPanel();
});

detailCloseBtn.addEventListener('click', closeDetail);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeDetail();
  }
});

function fetchQuery(query, bounds) {
  const coords = getBoundsArray(bounds);
  if (!coords) {
    return Promise.resolve();
  }
  const [west, south, east, north] = coords;
  const bbox = `${south},${west},${north},${east}`;
  const url = `/api/search?bbox=${encodeURIComponent(bbox)}&q=${encodeURIComponent(query.label)}`;
  return fetch(url)
    .then((res) => {
      if (!res.ok) {
        throw new Error('検索に失敗しました');
      }
      return res.json();
    })
    .then((payload) => {
      const items = (payload.items || []).map((poi) => ({ ...poi, queryId: query.id, color: query.color }));
      queryResults.set(query.id, items);
    })
    .catch((error) => {
      showToast(`${query.label} の取得に失敗しました`);
      console.error(error);
      queryResults.set(query.id, []);
    });
}

function runSearch(reason = 'manual') {
  if (!map || !mapReady || state.queries.length === 0) {
    return;
  }
  const bounds = map.getBounds();
  if (!bounds) {
    showToast('マップ範囲を取得できません');
    return;
  }
  searchAreaBtn.disabled = true;
  needsSearch = false;
  showToast('検索しています…');
  const promises = state.queries.map((query) => fetchQuery(query, bounds));
  Promise.all(promises).then(() => {
    searchCenter = getMapCenterLiteral();
    searchZoom = map.getZoom();
    showToast('検索が完了しました');
    applyFiltersAndRender();
    updateUrlState();
  });
}

async function initMap() {
  const apiKey = appConfig.googleMapsApiKey;
  if (!apiKey) {
    showToast('Google Maps APIキーが設定されていません');
    return;
  }
  try {
    googleMaps = await loadGoogleMaps(apiKey);
  } catch (error) {
    console.error(error);
    showToast('Google Mapsの読み込みに失敗しました');
    return;
  }

  map = new googleMaps.Map(mapContainer, {
    center: { lat: state.center.lat, lng: state.center.lng },
    zoom: state.zoom,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: 'greedy',
  });

  googleMaps.event.addListenerOnce(map, 'idle', () => {
    mapReady = true;
    updateSearchButtonState();
    updateUrlState();
    if (state.queries.length > 0) {
      runSearch('initial');
    }
  });

  map.addListener('idle', () => {
    if (!mapReady) {
      return;
    }
    updateUrlState();
    if (clusterIndex) {
      renderMarkers();
    }
    if (state.queries.length === 0) {
      return;
    }
    const currentCenter = getMapCenterLiteral();
    const currentZoom = map.getZoom();
    if (!searchCenter || searchZoom == null) {
      searchAreaBtn.disabled = false;
      needsSearch = true;
      return;
    }
    const movedCenter =
      !currentCenter ||
      Math.abs(currentCenter.lat - searchCenter.lat) > 0.0001 ||
      Math.abs(currentCenter.lng - searchCenter.lng) > 0.0001;
    const movedZoom =
      typeof currentZoom === 'number' && Math.abs(currentZoom - searchZoom) > 0.01;
    if (movedCenter || movedZoom) {
      searchAreaBtn.disabled = false;
      needsSearch = true;
    }
  });
}

function initForm() {
  queryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = queryInput.value;
    if (!value.trim()) {
      return;
    }
    const parts = value
      .split(/[,\u3001]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return;
    }
    parts.forEach((part) => addQuery(part));
    queryInput.value = '';
    if (mapReady && state.queries.length > 0) {
      runSearch('add-query');
    }
  });
}

function initFilters() {
  applyFiltersBtn.addEventListener('click', () => {
    state.filters.openNow = filterOpenNow.checked;
    state.filters.radius = filterRadius.value ? Number(filterRadius.value) : null;
    applyFiltersAndRender();
    updateUrlState();
  });

  resetFiltersBtn.addEventListener('click', () => {
    state.filters.openNow = false;
    state.filters.radius = null;
    filterOpenNow.checked = false;
    filterRadius.value = '';
    applyFiltersAndRender();
    updateUrlState();
  });
}

function initSearchButton() {
  searchAreaBtn.addEventListener('click', () => {
    if (mapReady && state.queries.length > 0) {
      runSearch('button');
    }
  });
}

function initLocateButton() {
  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('位置情報が利用できません');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!map) {
          return;
        }
        const currentZoom = map.getZoom();
        if (typeof currentZoom === 'number' && currentZoom < 14) {
          map.setZoom(14);
        }
        map.panTo({ lat: latitude, lng: longitude });
      },
      () => {
        showToast('現在地を取得できませんでした');
      },
      { enableHighAccuracy: false, timeout: 5000 }
    );
  });
}

parseInitialState();
initForm();
initFilters();
initSearchButton();
initLocateButton();
applyFiltersAndRender();
initMap();
