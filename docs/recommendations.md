# Home recommendations

Enable recommendations on Home to discover videos absent from your watch history.
The engine also uses favorites, saved videos and active-profile subscriptions, so
it can offer suggestions before your first watch. Partially watched videos stay
in Continue watching and are excluded from recommendations.

Home's Enable button and Customize Home visibility toggle are independent of
“Hide Recommended Videos”, which applies only to the watch page. Videos use the
same thumbnail grid/list and thumbnail-size preference as Subscriptions, with
reasons and feedback beneath each card. After enabling, the explanation moves
to the heading tooltip. The three-dot menu beside Refresh contains discovery
choices, reset, and a checked Enable recommendations item to turn learning off.

## Learning and discovery

The engine combines recent and longer-term topic interests, channel preferences,
actual playback, explicit feedback and previous impressions. Titles, phrases,
descriptions and keywords contribute to locally computed TF-IDF similarity.
Unicode word segmentation supports languages without spaces between words.

Candidate videos come from related-video requests, channel uploads, topic searches
and cached subscription feeds. Related videos can introduce channels and topics
whose titles share no words with your history. Strong, diverse seeds use completed
or substantially watched videos, favorites, saved videos and positive feedback.

Ranking accounts for relevance, source evidence, freshness, repeated exposure and
negative feedback. Selection limits channel repetition and near-duplicate topics.
Familiar, Balanced and Explore adjust the preference for unfamiliar channels.
Refresh and Load More rotate discovery sources.

“More like this” strengthens an interest. “Not interested” removes that video and
reduces similar topics. “Hide this channel” excludes the channel. Brief playback
after opening a recommendation supplies weaker negative evidence. A card counts
as an impression after at least 60% of it is visible for one second.

Playback learning works independently of watch statistics. Pauses, stalls and
large seeks do not add watch time. Existing history uses saved progress until
actual playback observations are available.

## Privacy and reset

Recommendations are opt-in and require history to be enabled. Learning records
stay in the local `recommendations.db`; there is no recommendation server or
cross-user tracking. The selected video backend receives topic searches, channel
IDs and video IDs needed to fetch candidates. Backend fallback follows the app's
existing setting. Hiding the Home section or leaving its tab stops discovery
requests; disabling recommendations also stops learning.

Reset recommendations clears learned feedback and exposure. History, favorites,
saved videos and subscriptions can still seed the next feed. Deleting a history
entry removes its learned contribution; clearing history clears all learning.
Records expire after 180 days and are capped at 1,500 videos. Feedback and resets
are shared between app windows and survive restarts.

## Scope

The design draws inspiration from [Flow Android Client](https://github.com/A-EDev/Flow),
including its combination of local interests, related-video discovery, feedback,
impression penalties and exploration. This is an independent implementation with
reversible per-video evidence. It does not reproduce every Flow signal, such as
time-of-day personas or channel co-watch affinity, and has not been benchmarked
against Flow for recommendation quality. Ranking is heuristic, and discovery is
limited by the candidates returned by the selected backend.
