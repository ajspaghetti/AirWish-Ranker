# AirWish Ranker: scoring model v3

Location-agnostic. Every number below is a default you can change in Settings; Reset returns to these.

## 1. Pipeline

```
Airbnb (your session)            OpenStreetMap
  wishlist cards                   points of interest around each listing (Overpass)
  listing details + amenities      walking routes to the nearest few (Valhalla)
  every review (flags only)
        │                                │
        └──────── record per listing ────┘
                       │
        tags (yes / no / unknown per listing)
                       │
        factors F ∈ [0,100], each in exactly one category
                       │
        categories C (weighted mean of active factors)
                       │
        Overall O (balanced categories × preset weights)   Budget B
                       │
        rules (Must have / Exclude), view filters, sort, search
```

## 2. Shared formulas

```
dist(t)  = 100                              if t ≤ full
         = 100 · 2^(−(t − full) / half)     otherwise            t = walking minutes
cnt(n)   = 100 · (1 − e^(−n / k))                                n = count within radius
q(R)     = clamp((R − 4.0) / 1.0, 0, 1)²                          rating quality
w(n)     = 1 − e^(−n / 25)                                        trust from review count
Proven   = 100 · [ w(n)·q(R) + (1 − w(n))·q(R₀) ]                 R₀ = 4.70 fixed (or wishlist P25)
rate     = (Σ per-review max tag weight + k·prior) / (reviews + k)     k = 10
Red      = 100 · 2^(−rate / 0.04)        prior 0.03
Green    = 100 · (1 − 2^(−rate / 0.25))  prior 0.30
Stairs   = 100 · 2^(−rate / 0.06)        prior 0.04
Coverage = 100 · (Σ_want w·x − Σ_avoid w·x) / Σ_want,known w      x ∈ {1, 0}; unknown skipped
BestOf   = max(value of present tags) + bonuses, capped at 100
```

Walking minutes are routed on foot where the router answers, otherwise straight line × 1.3 / 80 m per min.
A destination type that exists near some listings but not others counts as 5 km for the others.

## 3. Factors

| Category (default weight) | Factor | w | Input | Transform |
|---|---|---|---|---|
| Location (22) | Guest location rating | 20 | location sub-rating, reviews | Proven |
| | Walk to public transport | 18 | train, metro, tram, light rail (ferry if none within 1.5 km) | dist, full 4, half 8 |
| | Walk to the center | 12 | nearest place node, city ≻ town ≻ village (distance ÷ rank) | dist, full 5, half 12 |
| | Walkability | 18 | groceries ≤600 m (w3,k2), eating ≤500 m (3,8), pharmacy ≤800 m (1,1), stops ≤500 m (2,3), parks ≤600 m (1,1) | weighted cnt |
| | Places to eat nearby | 8 | restaurants, cafes ≤500 m | cnt, k 25 |
| | Sights nearby | 10 | attractions, museums, viewpoints, historic ≤1 km | cnt, k 20 |
| | Nightlife nearby | 4 | bars, pubs, clubs ≤600 m (invert to prefer quiet) | cnt, k 8 |
| | Walk to the sea or a beach | 4 | beach or coastline | dist, full 3, half 8 |
| | Walk to a lake or river | 2 | lake, reservoir, river, canal | dist, full 3, half 8 |
| | Walk to a park | 4 | park or public garden | dist, full 3, half 6 |
| Space & Sleep (16) | Real beds for the group | 30 | real-bed spots: king, queen, double, bunk 2; single 1; undescribed bed 0.5; sofa, couch, futon, mattress, crib 0 | 100 if spots ≥ adults, else 60·spots/adults |
| | Number of real beds | 15 | real beds vs need (pairs share: ⌈adults/2⌉; or one each) | 100·min(1, beds/need) |
| | Bedrooms | 25 | bedrooms (studio = 0.5) vs need | 100·min(1, rooms/need) |
| | Bathrooms | 20 | baths (shared counts half) vs adults/2 | 100·min(1, baths/max(1, adults/2)) |
| | Guest headroom | 10 | max guests − adults | ≥2 →100, 1 →70, 0 →40, <0 →0 |
| Comfort & Amenities (12) | Essentials | 45 | wifi 10, AC 10, kitchen 8, washer 5, heating 4, dryer 2, workspace 2, dishwasher 2, coffee 1, TV 1 | Coverage |
| | Step-free access | 25 | elevator or single level →100; else Stairs score, capped 40 if "Must climb stairs", 50 if "no elevator" | |
| | Convenience | 15 | self check-in 3, free parking 2, private entrance 1, luggage drop-off 1 | Coverage |
| | Extras | 15 | pool 4, hot tub 3, sauna 1, gym 1, fireplace 1, bathtub 1, EV charger 0.5 | Coverage |
| Outdoor & Views (8) | Outdoor space | 55 | rooftop 100, terrace 90, garden 90, balcony 75, patio 70, courtyard 45; + outdoor dining 10, BBQ 5, loungers 5 | BestOf |
| | View | 45 | sea 100, lake/river/canal 90, mountain/valley 85, city 75, garden/park 45 | BestOf |
| Reviews & Trust (20) | Proven rating | 30 | overall rating, reviews | Proven |
| | Cleanliness / Accuracy / Check-in / Communication | 12 / 10 / 3 / 5 | sub-ratings | Proven |
| | Red flags in reviews | 20 | red tags per review (severity below) | Red |
| | Green flags in reviews | 8 | green tags per review (value below) | Green |
| | Listing warnings | 6 | warning tags (severity below) | 100·2^(−Σ severity) |
| | Superhost | 3 | | 100 / 0 |
| | Cancellation policy | 3 | Flexible 100, Moderate 80, Limited 65, Firm 50, Strict 30, Non-refundable 0 | |
| Value (8) | Price per adult per night | 100 | vs wishlist median | clamp(50 − 50·log₂(p / median)) |
| Our votes (14) | | | Yes / No per voter | 50 + 50·(Yes − No) / voters |

Red flag severities: damp or mold 1, dirty 1, pests 1, not as described 1, safety 1, smells 0.8, cancellations or refunds 0.8, broken 0.6, too hot 0.6, host issues 0.6, too cold 0.5, noise 0.5, uncomfortable beds 0.5, weak wifi 0.3, cramped 0.3, mosquitoes 0.2.
Green flag values: spotless 1, comfy beds 1, quiet 0.8, as described 0.8, guests would return 0.8, great location 0.7, great views 0.6, spacious 0.6, great host 0.5, well equipped 0.5, great value 0.5, cool AC 0.4, easy check-in 0.3.
Warning severities: smoke alarm not reported 0.5, weapons 0.5, potential for noise 0.5, shared spaces 0.4, CO alarm not reported 0.3, cameras 0.2, pets on property 0.2.

Amenity tags: Airbnb lists missing essentials under "Not included", so an essential that is not mentioned at all is unknown (skipped); an extra that is not mentioned is absent (0).

## 4. Combining

```
C_c       = Σ w_f·F_f / Σ w_f        over factors that are on, weighted, have data, and differ across the wishlist
Ĉ_c       = clamp(50 + 20·(C_c − μ_c) / max(σ_c, 8), 0, 100)        balancing (on by default)
O         = Σ π_c·Ĉ_c / Σ π_c
B         = 0.6·C_value + 0.4·O        Budget board: rating ≥ 4.6 and red-flag rate ≤ 8%
Ranks     = score desc, then rating desc, price asc, wishlist order
```

Presets π (Location, Space, Comfort, Outdoor, Trust, Value, Votes):
Balanced 22 16 12 8 20 8 14 · Location first 38 12 10 6 16 6 12 · Comfort first 14 22 20 12 16 4 12 · No surprises 14 14 10 6 38 6 12 · Best value 16 14 10 6 18 24 12.

Why balancing: without it a category whose scores spread widely moves the ranking more than its weight says. With it, each category is rescaled to the same spread first, so 22% means 22%. The floor of 8 points stops near-identical categories from being stretched.

Why factors that do not differ are dropped: a factor equal for every listing (no pools anywhere, every place inside the same national park) cannot change ranks but would dilute the rest of its category.

## 5. Tags

About 110 tags in 12 groups: Essentials, Extras, Convenience, Outdoor, Views, Access, Sleep & bath, Location, Warnings, Status, Red flags, Green flags.
Every tag is filterable (click: require, again: exclude). In Settings each tag can be Normal, Must have or Exclude everywhere; coverage tags can also be Avoid (subtracts) or Ignore.
Review flag tags appear on a listing when at least 2 reviews mention them and they reach 1% of reviews (severity-1 tags always show at 2); green tags need 3 reviews and 15% (30% for great location and great host, which most reviews say).

## 6. Sharing

Share to phone packs up to 5 listings (name, town, photo, price per adult per night, rating, beds, transit, score,
category scores, top pros and cons, votes) into about 2 KB. Three outputs from the same data:
- Link: deflate + base64url after `#d=` on the share page (GitHub Pages). Browsers never send the part after # to the server.
- Text: one block per listing with its Airbnb link, for any SMS app.
- Page file: the same page as one self-contained HTML file, photos embedded, no JavaScript, so Messages can preview it.
