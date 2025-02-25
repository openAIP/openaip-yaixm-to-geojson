export type CoordLike = [number, number];

export type GeoJsonAirspaceCeiling = {
    value: number;
    unit: string;
    referenceDatum: string;
};

export type GeoJsonAirspaceService = {
    callsign: string;
    frequency: string;
};

export type GeoJsonAirspaceFeatureProperties = {
    name: string;
    type: string;
    class: string;
    upperCeiling: GeoJsonAirspaceCeiling;
    lowerCeiling: GeoJsonAirspaceCeiling;
    activatedByNotam: boolean;
    activity: string;
    remarks: string;
    groundService?: GeoJsonAirspaceService;
};

export type GeoJsonAirspaceFeature = GeoJSON.Feature<GeoJSON.Polygon, GeoJsonAirspaceFeatureProperties>;
