# YAIXM to GeoJSON Converter

A utility that converts YAIXM format into GeoJSON for Node. This tool is intended to work with the YAIXM format
used in the unofficial [UK Airspace Repository](https://github.com/ahsparrow/airspace). Currently, the logic only 
supports reading `airspace` YAIXM definitions.

Internally, the logic uses parts of our [OpenAIR Parser](https://github.com/openAIP/openaip-openair-parser) to also validate the
given YAIXM definitions.

Reads YAIXM airspace definition:

```YAML
airspace:
    - name: ABERDEEN CTA
      id: aberdeen-cta
      type: CTA
      class: D
      geometry:
          - seqno: 1
            upper: FL115
            lower: 1500 ft
            boundary:
                - line:
                      - 572153N 0015835W
                      - 572100N 0015802W
                      - 572100N 0023356W
                - arc:
                      dir: cw
                      radius: 10 nm
                      centre: 571834N 0021602W
                      to: 572153N 0015835W
          - seqno: 2
            upper: FL115
            lower: 1500 ft
            boundary:
                - line:
                      - 571522N 0015428W
                      - 570845N 0015019W
                - arc:
                      dir: cw
                      radius: 10 nm
                      centre: 570531N 0020740W
                      to: 570214N 0022458W
                - line:
                      - 570850N 0022913W
                - arc:
                      dir: ccw
                      radius: 10 nm
                      centre: 571207N 0021152W
                      to: 571522N 0015428W
          - seqno: 3
            upper: FL115
            lower: 3000 ft
            boundary:
                - line:
                      - 572100N 0023356W
                      - 570015N 0025056W
                      - 565433N 0023557W
                      - 565533N 0020635W
                - arc:
                      dir: cw
                      radius: 10 nm
                      centre: 570531N 0020740W
                      to: 570214N 0022458W
                - line:
                      - 571520N 0023326W
                - arc:
                      dir: cw
                      radius: 10 nm
                      centre: 571834N 0021602W
                      to: 572100N 0023356W

    - name: ARGYLL CTA
      type: CTA
      class: E
      geometry:
          - seqno: 1
            class: E
            rules:
                - TMZ
            upper: FL195
            lower: 5500 ft
            boundary:
                - line:
                      - 561844N 0054648W
                      - 560727N 0050308W
                      - 560127N 0044028W
                      - 560000N 0044400W
                      - 555356N 0045343W
                      - 555825N 0051042W
                      - 560939N 0055411W
          - seqno: 2
            rules:
                - TMZ
            upper: FL195
            lower: FL115
            boundary:
                - line:
                      - 564819N 0062031W
                      - 561807N 0054423W
                      - 561844N 0054648W
                      - 560939N 0055411W
                      - 562501N 0065609W
                      - 563408N 0064847W
                      - 562552N 0061508W
                      - 564248N 0063539W
          - seqno: 3
            rules:
                - TMZ
            upper: FL195
            lower: FL105
            boundary:
                - line:
                      - 553039N 0053655W
                      - 552543N 0050000W
                      - 551527N 0050000W
                      - 552057N 0054102W
```

Outputs a GeoJSON FeatureCollection with the following JSON schema:

```JSON
{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://adhoc-schemas.openaip.net/schemas/parsed-yaixm-airspace.json",
    "description": "JSON Schema for the GeoJSON FeatureCollection returned by this converter.",
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": [
                "FeatureCollection"
            ],
            "description": "A GeoJSON FeatureCollection object that contains all airspace features."
        },
        "features": {
            "type": "array",
            "items": {
                "allOf": [
                    {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": [
                                    "Feature"
                                ]
                            },
                            "properties": {
                                "type": "object",
                                "properties": {
                                    "name": {
                                        "type": "string",
                                        "description": "The airspace's name."
                                    },
                                    "type": {
                                        "type": "string",
                                        "enum": [
                                            "CTA",
                                            "TMA",
                                            "CTR",
                                            "ATZ",
                                            "DANGER",
                                            "PROHIBITED",
                                            "RESTRICTED",
                                            "WARNING",
                                            "AERIAL_SPORTING_RECREATIONAL",
                                            "RMZ",
                                            "TMZ",
                                            "MATZ",
                                            "GLIDING_SECTOR"
                                        ],
                                        "description": "The airspace's type."
                                    },
                                    "class": {
                                        "type": "string",
                                        "enum": [
                                            "A",
                                            "B",
                                            "C",
                                            "D",
                                            "E",
                                            "F",
                                            "G",
                                            "UNCLASSIFIED"
                                        ],
                                        "description": "The airspace's class."
                                    },
                                    "activity": {
                                        "type": "string",
                                        "enum": [
                                            "NONE",
                                            "PARACHUTING",
                                            "AEROBATICS",
                                            "AEROCLUB_AERIAL_WORK",
                                            "ULM",
                                            "HANG_GLIDING"
                                        ],
                                        "description": "Property that adds metadata about specific type of arial/sporting areas. Is 'NONE' by default."
                                    },
                                    "upperCeiling": {
                                        "$ref": "#/definitions/verticalLimit"
                                    },
                                    "lowerCeiling": {
                                        "$ref": "#/definitions/verticalLimit"
                                    },
                                    "activatedByNotam": { "type": "boolean", "description": "If true, the airspace is activated by a NOTAM." },
                                    "groundService": {
                                        "type": "object",
                                        "properties": {
                                            "callsign": { "type": "string" , "example": "ABERDEEN APPROACH"},
                                            "frequency": { "type": "string", "example": "118.000" }
                                        },
                                        "description": "The ground service callsign and frequency if available.",
                                        "required": [
                                            "callsign",
                                            "frequency"
                                        ],
                                        "additionalProperties": false
                                    },
                                    "remarks": {
                                        "type": "string",
                                        "description": "A remarks field. If available, this will contain content of the parsed 'rules' list to add more metadata on the airspace."
                                    }
                                },
                                "required": [
                                    "name",
                                    "type",
                                    "class",
                                    "upperCeiling",
                                    "lowerCeiling",
                                    "activatedByNotam",
                                    "activity"
                                ],
                                "additionalProperties": false
                            },
                            "geometry": {
                                "type": "object",
                                "properties": {
                                    "type": {
                                        "type": "string",
                                        "enum": [
                                            "Polygon"
                                        ]
                                    },
                                    "coordinates": {
                                        "type": "array",
                                        "items": {
                                            "type": "array",
                                            "items": {
                                                "type": "array",
                                                "items": false,
                                                "prefixItems": [
                                                    {
                                                        "type": "number",
                                                        "minimum": -180,
                                                        "maximum": 180
                                                    },
                                                    {
                                                        "type": "number",
                                                        "minimum": -90,
                                                        "maximum": 90
                                                    }
                                                ],
                                                "minItems": 2,
                                                "maxItems": 2
                                            },
                                            "minItems": 4
                                        },
                                        "minItems": 1,
                                        "maxItems": 1
                                    }
                                },
                                "required": [
                                    "type",
                                    "coordinates"
                                ],
                                "additionalProperties": false,
                                "example": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [
                                            [
                                                9.1234,
                                                45.42432
                                            ],
                                            [
                                                10.1234,
                                                45.42432
                                            ],
                                            [
                                                10.1234,
                                                47.42432
                                            ],
                                            [
                                                9.1234,
                                                45.42432
                                            ]
                                        ]
                                    ]
                                }
                            }
                        },
                        "required": [
                            "type",
                            "properties",
                            "geometry"
                        ],
                        "additionalProperties": false
                    }
                ]
            }
        }
    },
    "required": [
        "type",
        "features"
    ],
    "additionalProperties": false,
    "definitions": {
        "verticalLimit": {
            "type": "object",
            "properties": {
                "value": {
                    "type": "integer"
                },
                "unit": {
                    "type": "string",
                    "enum": [
                        "FT",
                        "FL"
                    ]
                },
                "referenceDatum": {
                    "type": "string",
                    "enum": [
                        "GND",
                        "STD",
                        "MSL"
                    ]
                }
            },
            "required": [
                "value",
                "unit",
                "referenceDatum"
            ],
            "description": "Defines an airspace vertical limit. The vertical limit is a combination of an integer value, a measurement unit and a reference datum.",
            "additionalProperties": false
        }
    }
}
```

Install
=
```shell
npm install -g @openaip/yaixm-to-geojson
```

Node
=

```javascript
const { YaixmConverter } = require('@openaip/yaixm-to-geojson');

const inputFilePath = './path/to/input-yaixm-file.txt';

const converter = new YaixmConverter({ fixGeometries: true, strictSchemaValidation: true });
// or alternatively call "convertFromBuffer" to read from Buffer
await converter.convertFromFile(inputFilepath, { type: 'airspace' });
const geojson = converter.toGeojson();
```

CLI
=

```bash
node cli.js -h

Usage: cli [options]

Options:
  -f, --input-filepath <inputFilepath>    The input file path to the YAIXM file.
  -o, --output-filepath <outputFilepath>  The output filename of the generated GeoJSON file.
  -T, --type                              The type to read from YAIXM file. Currently only "airspace" is supported. (default: "airspace")
  -V, --validate                          If specified, converter will validate geometries.
  -F, --fix-geometry                      If specified, converter will try to fix geometries.
  -S, --strict-schema-validation          If specified, converter will strictly validate the created GeoJSON against the underlying schema. If the GeoJSON does not match the JSON schema, the converter will throw an error.
  -h, --help                              Outputs usage information.
```

Simple command line usage:

```bash
node cli.js --type=airspace -f ./path/to/input-yaixm-file.txt -o ./path/to/output-geojson-file.geojson
```
