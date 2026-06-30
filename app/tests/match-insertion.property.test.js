/**
 * Property-Based Test: Round-trip d'insertion de match
 *
 * Feature: capstone-cloud-resilience, Property 1: Round-trip d'insertion de match
 * Validates: Requirements 4.1
 *
 * For any valid JSON body containing a non-empty team_home, non-empty team_away,
 * score_home >= 0, score_away >= 0, a stage among accepted values, and an ISO date,
 * POST /api/data must return HTTP 201 with an id, and the inserted data must match
 * the input values.
 */

const fc = require('fast-check');
const request = require('supertest');

// Mock pg before requiring the app
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const mockPool = { query: mockQuery };
  return { Pool: jest.fn(() => mockPool) };
});

const { app, pool } = require('../main');

const validStages = ['Group Stage', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];

describe('Feature: capstone-cloud-resilience, Property 1: Round-trip d\'insertion de match', () => {
  let insertedData;
  let server;

  // Serveur HTTP persistant réutilisé sur toutes les itérations. Évite la race de
  // supertest qui, avec request(app), démarre/arrête un serveur éphémère à chaque
  // appel (100×) — source de 404 intermittents non déterministes.
  beforeAll(() => {
    server = app.listen(0);
  });

  afterAll((done) => {
    jest.restoreAllMocks();
    server.close(done);
  });

  beforeEach(() => {
    insertedData = null;
    pool.query.mockReset();
  });

  it('should return HTTP 201 with an id and inserted data matches input for any valid match data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          team_home: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
          team_away: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
          score_home: fc.nat(),
          score_away: fc.nat(),
          stage: fc.constantFrom(...validStages),
          // noInvalidDate : exclut `new Date(NaN)`, qui n'est pas une donnée valide
          // et ferait planter toISOString() avant même d'appeler l'app.
          date: fc.date({
            min: new Date('2000-01-01'),
            max: new Date('2099-12-31'),
            noInvalidDate: true,
          }),
        }),
        async (matchData) => {
          const dateStr = matchData.date.toISOString().split('T')[0];
          let capturedInsertParams = null;

          // Mock pool.query to simulate DB behavior. Les équipes sont distinguées par
          // ORDRE d'appel (l'app cherche d'abord team_home, puis team_away) et non par
          // nom : robuste même si team_home et team_away sont identiques.
          // 1st SELECT teams -> {id: 1} (home), 2nd SELECT teams -> {id: 2} (away)
          // INSERT INTO matches ... RETURNING id -> {id: 42}
          let teamLookupCount = 0;
          pool.query.mockImplementation((sql, params) => {
            if (sql.includes('SELECT id FROM teams WHERE name')) {
              teamLookupCount += 1;
              return Promise.resolve({ rows: [{ id: teamLookupCount }] });
            }
            if (sql.includes('INSERT INTO matches')) {
              capturedInsertParams = params;
              return Promise.resolve({ rows: [{ id: 42 }] });
            }
            return Promise.resolve({ rows: [] });
          });

          const payload = {
            team_home: matchData.team_home,
            team_away: matchData.team_away,
            score_home: matchData.score_home,
            score_away: matchData.score_away,
            stage: matchData.stage,
            date: dateStr,
          };

          const res = await request(server)
            .post('/api/data')
            .set('Content-Type', 'application/json')
            .send(payload);

          // Property assertions:
          // 1. Response status is 201
          expect(res.status).toBe(201);

          // 2. Response body contains an id field
          expect(res.body).toHaveProperty('id');
          expect(res.body.id).toBe(42);

          // 3. The data that would be inserted matches the input data
          expect(capturedInsertParams).not.toBeNull();
          // capturedInsertParams = [teamHomeId, teamAwayId, score_home, score_away, stage, date]
          expect(capturedInsertParams[0]).toBe(1); // team_home_id
          expect(capturedInsertParams[1]).toBe(2); // team_away_id
          expect(capturedInsertParams[2]).toBe(matchData.score_home);
          expect(capturedInsertParams[3]).toBe(matchData.score_away);
          expect(capturedInsertParams[4]).toBe(matchData.stage);
          expect(capturedInsertParams[5]).toBe(dateStr);
        }
      ),
      { numRuns: 100 }
    );
  });
});
