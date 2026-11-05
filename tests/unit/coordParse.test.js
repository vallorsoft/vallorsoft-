const { parseCoords } = require('../../lib/coordParse');

describe('parseCoords — beírt koordináta felismerése', () => {
  test.each([
    ['45.12345, 25.45678', 45.12345, 25.45678],
    ['45.12345 25.45678', 45.12345, 25.45678],
    ['45,12345 25,45678', 45.12345, 25.45678],
    ['45.123 N, 25.456 E', 45.123, 25.456],
    ['N45.123 E25.456', 45.123, 25.456],
    ['25.456 E 45.123 N', 45.123, 25.456],
    ['45°07\'23.4"N 25°27\'21"E', 45.123167, 25.455833],
    ['-33.86, 151.2', -33.86, 151.2],
    ['lat: 45.1, lng: 25.2', 45.1, 25.2],
    ['https://www.google.com/maps/place/x/@45.6579,25.6012,15z', 45.6579, 25.6012],
    ['https://wego.here.com/?map=45.65,25.60,15', 45.65, 25.6],
    ['https://www.openstreetmap.org/#map=15/45.65/25.60', 45.65, 25.6],
  ])('%s', (s, lat, lng) => {
    expect(parseCoords(s)).toEqual({ lat, lng });
  });
  test.each(['Strada Lunga 45', '45 25', 'Brasov', '12 Mai 2026', '0,0', '200.1, 300.2', ''])('nem koordináta: %s', (s) => {
    expect(parseCoords(s)).toBeNull();
  });
});
