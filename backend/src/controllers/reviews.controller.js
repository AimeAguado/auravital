const { Controller, Get, Req, Res } = require('@nestjs/common');
const { googlePlacesApiKey, googlePlaceId, googlePlacesQuery, googleReviewUrl, googleMapsUrl } = require('../../lib/config');

const REVIEW_LIMIT = 3;
const CACHE_TTL = 60 * 60 * 1000;
const SEARCH_FIELD_MASK = 'places.displayName,places.reviews,places.rating,places.userRatingCount,places.googleMapsUri';
const DETAILS_FIELD_MASK = 'displayName,reviews,rating,userRatingCount,googleMapsUri';

let cache = { expiresAt: 0, data: null };
let pending = null;

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Google Places respondió HTTP ${response.status}.`);
  return payload;
}

async function fetchPlace() {
  if (googlePlaceId) {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}?languageCode=es&regionCode=AR`, {
      headers: { 'X-Goog-Api-Key': googlePlacesApiKey, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
    });
    return readJson(response);
  }
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googlePlacesApiKey,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: googlePlacesQuery, languageCode: 'es', regionCode: 'AR' }),
  });
  const payload = await readJson(response);
  return (payload.places || []).find(item => String(item.displayName?.text || '').toLowerCase().includes('aura')) || payload.places?.[0] || null;
}

function normalizePlace(place) {
  const reviews = (place?.reviews || [])
    .map(review => ({
      author: review.authorAttribution?.displayName || 'Usuario de Google',
      authorUri: review.authorAttribution?.uri || '',
      rating: Number(review.rating) || 0,
      text: review.originalText?.text || review.text?.text || '',
      published: review.relativePublishTimeDescription || '',
      publishTime: review.publishTime || '',
      permalink: review.googleMapsUri || '',
    }))
    .filter(review => review.rating === 5)
    .sort((a, b) => Date.parse(b.publishTime || 0) - Date.parse(a.publishTime || 0))
    .slice(0, REVIEW_LIMIT);

  return {
    reviews,
    rating: Number(place?.rating) || null,
    userRatingCount: Number(place?.userRatingCount) || 0,
    googleMapsUri: place?.googleMapsUri || googleMapsUrl,
    reviewUrl: googleReviewUrl,
  };
}

class ReviewsController {
  async list(_req, res) {
    if (!googlePlacesApiKey) return res.status(503).json({ error: 'La conexión de reseñas de Google todavía no está configurada.' });
    try {
      if (cache.expiresAt <= Date.now()) {
        if (!pending) {
          pending = fetchPlace().then(normalizePlace).finally(() => { pending = null; });
        }
        cache = { data: await pending, expiresAt: Date.now() + CACHE_TTL };
      }
      res.json(cache.data);
    } catch (error) {
      console.error(`No se pudieron cargar reseñas de Google: ${error.message}`);
      res.status(502).json({ error: 'No pudimos cargar las reseñas de Google en este momento.' });
    }
  }
}

Controller('api/reviews')(ReviewsController);
Get('')(ReviewsController.prototype, 'list', Object.getOwnPropertyDescriptor(ReviewsController.prototype, 'list'));
Req()(ReviewsController.prototype, 'list', 0);
Res()(ReviewsController.prototype, 'list', 1);

module.exports = { ReviewsController };
