import { applySpiralOffset } from './mapUtils';

describe('applySpiralOffset', () => {
  it('leaves unique coordinates unchanged', () => {
    const appraisals = [
      { id: 'a', latitude: 43.7, longitude: -79.4 },
      { id: 'b', latitude: 43.8, longitude: -79.5 },
    ];

    expect(applySpiralOffset(appraisals)).toEqual(appraisals);
  });

  it('offsets repeated coordinates without mutating the first marker', () => {
    const appraisals = [
      { id: 'a', latitude: 43.7, longitude: -79.4 },
      { id: 'b', latitude: 43.7, longitude: -79.4 },
    ];

    const result = applySpiralOffset(appraisals);

    expect(result[0]).toEqual(appraisals[0]);
    expect([result[1].latitude, result[1].longitude]).not.toEqual([
      appraisals[1].latitude,
      appraisals[1].longitude,
    ]);
  });
});
