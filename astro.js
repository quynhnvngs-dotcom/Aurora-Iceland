// Vị trí Mặt Trời / Mặt Trăng (theo công thức của thư viện SunCalc, Vladimir Agafonkin, BSD-2)
(function () {
  const PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan,
    asin = Math.asin, atan = Math.atan2, acos = Math.acos, rad = PI / 180;
  const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;

  const toDays = (date) => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const rightAscension = (l, b) => atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
  const declination = (l, b) => asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
  const altitude = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
  const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
  const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
  function eclipticLongitude(M) {
    const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
    return M + C + rad * 102.9372 + PI;
  }
  function sunCoords(d) {
    const L = eclipticLongitude(solarMeanAnomaly(d));
    return { dec: declination(L, 0), ra: rightAscension(L, 0) };
  }
  function moonCoords(d) {
    const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d),
      F = rad * (93.272 + 13.22935 * d);
    const l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F), dt = 385001 - 20905 * cos(M);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
  }
  function refraction(h) {
    if (h < 0) h = 0;
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
  }
  function sunAltitude(date, lat, lon) {
    const lw = rad * -lon, phi = rad * lat, d = toDays(date), c = sunCoords(d);
    return altitude(siderealTime(d, lw) - c.ra, phi, c.dec) / rad;
  }
  function moonAltitude(date, lat, lon) {
    const lw = rad * -lon, phi = rad * lat, d = toDays(date), c = moonCoords(d);
    const h = altitude(siderealTime(d, lw) - c.ra, phi, c.dec);
    return (h + refraction(h)) / rad;
  }
  function moonIllumination(date) {
    const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
    const inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi));
    const angle = atan(cos(s.dec) * sin(s.ra - m.ra),
      sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
    return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / PI };
  }
  // Tìm các mốc trong `hours` giờ tới bằng cách dò độ cao mỗi 5 phút
  function events(start, lat, lon, hours = 30) {
    const step = 5 * 60e3, out = { sunset: null, darkStart: null, darkEnd: null, sunrise: null, moonrise: null, moonset: null };
    let pS = sunAltitude(start, lat, lon), pM = moonAltitude(start, lat, lon);
    for (let t = start.getTime() + step; t <= start.getTime() + hours * 36e5; t += step) {
      const d = new Date(t), s = sunAltitude(d, lat, lon), m = moonAltitude(d, lat, lon);
      if (!out.sunset && pS >= -0.833 && s < -0.833) out.sunset = d;
      if (!out.darkStart && pS >= -18 && s < -18) out.darkStart = d;
      if (!out.darkEnd && pS < -18 && s >= -18) out.darkEnd = d;
      if (!out.sunrise && pS < -0.833 && s >= -0.833) out.sunrise = d;
      if (!out.moonrise && pM < 0.133 && m >= 0.133) out.moonrise = d;
      if (!out.moonset && pM >= 0.133 && m < 0.133) out.moonset = d;
      pS = s; pM = m;
    }
    return out;
  }
  window.Astro = { sunAltitude, moonAltitude, moonIllumination, events };
})();
