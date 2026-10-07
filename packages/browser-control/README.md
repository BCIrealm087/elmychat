# Browser-control boundary

Planned Node.js CDP transport and session lifecycle: discover explicitly selected OBS targets, attach to their frame contexts, inject adapters, route reports and placements, and recover after navigation or destruction. Cross-origin frames can require separate sessions; do not assume one target covers every document. The coordinator supplies adapter code and receives lifecycle events. No CDP client is implemented yet.
