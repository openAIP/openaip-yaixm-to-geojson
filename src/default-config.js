module.exports = {
    // If true, validates each built airspace geometry to be valid/simple geometry - also checks for self intersections.
    validateGeometries: true,
    // If true, tries to fix an invalid geometry - note that this potentially alters the original airspace geometry!
    fixGeometries: false,
    // Defines the level of detail (smoothness) of arc/circular geometries.
    geometryDetail: 100,
    // If true, the created GEOJSON is validated against the underlying schema to enforce compatibility. If not true, simply warns on console about schema mismatch.
    strictSchemaValidation: false,
};
