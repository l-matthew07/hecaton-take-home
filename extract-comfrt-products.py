# HELP GET PRODUCT LIST AND COLOR PALETTE FROM COMFRT

import json, re

data = json.load(open('products.json'))

# Extract and clean product names
raw_products = set()
for p in data['products']:
    title = p['title']
    # Remove suffixes we don't want
    title = re.sub(r'\s*[-–]\s*(Pre[-\s]?Order|Farewell|Pre Order).*$', '', title, flags=re.IGNORECASE).strip()
    # Skip non-clothing items and variants
    skip = ['keychain', 'blanket', 'pillow', 'robe', 'sock', 'luggage', 'bag', 'tote', 'bundle', 'vip', 'club', 'photo', 'set', 'bed', 'heated', 'weighted blanket', 'ember', 'faux fur', 'cuddlecloud', 'dreamer pillow']
    if not any(s in title.lower() for s in skip):
        raw_products.add(title)

# Extract valid colors (filter out bundle/save noise)
raw_colors = set()
for p in data['products']:
    for v in p['variants']:
        c = v.get('option1', '')
        if c and not any(x in c.lower() for x in ['bundle', 'save', 'default', 'limited', 'stock', 'time']):
            raw_colors.add(c)

products = sorted(raw_products)
colors = sorted(raw_colors)

out_path = 'lib/reference/comfrtProducts.ts'

with open(out_path, 'w') as f:
    f.write('export const COMFRT_PRODUCTS = [\n')
    for p in products:
        f.write(f'  "{p.replace(chr(34), chr(92) + chr(34))}",\n')
    f.write(']\n\n')
    f.write('export const COMFRT_COLORS = [\n')
    for c in colors:
        f.write(f'  "{c.replace(chr(34), chr(92) + chr(34))}",\n')
    f.write(']\n')

print(f'Written {len(products)} products and {len(colors)} colors to {out_path}')