# OpenAIR Fix Format

A utility that converts YAIXM format into GeoJSON for Node. This tool is intended to work with the YAIXM format
used in the unofficial [UK Airspace Repository](https://github.com/ahsparrow/airspace). Currently the logic only 
supports reading `airspace` YAIXM definitions.

Internally, the logic uses parts of our [OpenAIR Parser](https://github.com/openAIP/openaip-openair-parser) to also validate the
given YAIXM definitions. The GeoJSON output is compatible with the output of our [OpenAIR Parser](https://github.com/openAIP/openaip-openair-parser).

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

Install
=
```shell
npm install -g @openaip/yaixm-to-geojson
```

Node
=

```javascript
const yaixmToGeojson = require('@openaip/yaixm-to-geojson');

await yaixmToGeojson.convert({in: './path/to/input-yiaxm-file.txt', out:'./path/to/output-geojson-file.geojson', type: 'airspace'});
```

CLI
=

```bash
node cli.js -h

Usage: cli [options]

Options:
  -f, --input-filepath <inFilepath>    The input file path to the YAIXM file.
  -o, --output-filepath <outFilepath>  The output filename of the generated GeoJSON file.
  -T, --type                           The type to read from YAIXM file. Currently only "airspace" is supported. (default: "airspace")
  -h, --help                           Outputs usage information.
```

Simple command line usage:

```bash
node cli.js --type=airspace -f ./path/to/input-yiaxm-file.txt -o ./path/to/output-geojson-file.geojson
```
