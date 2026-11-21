import bomText from './demo/demo-bom.csv?raw'
import pnpText from './demo/demo-pnp.csv?raw'

// A made-up 20-part board (ATtiny85 blinker with a 3.3 V regulator) so the app works
// with no uploads and no hardware. Includes polarized parts, spares, and a DNP row.
export const demoBoardText = { name: 'Demo: ATtiny85 blinker', bomText, pnpText }
