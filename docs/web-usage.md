# Web Usage Guide

This guide explains how to navigate the **3D Solar System — Interactive Orrery**,
control simulation time, compare distance views, inspect the Voyager probes, and
use the eclipse visualizations.

[Back to the project README](../README.md)

## Open the app

Use the [live demo](https://buithethuat03.github.io/solar-system/) or serve a local
copy over HTTP. From the repository root, run:

```bash
python server.py
```

Open <http://127.0.0.1:8000/> in a modern WebGL-capable browser. A different port
can be passed as the first argument:

```bash
python server.py 5500
```

Do not open `index.html` directly with a `file://` URL. Browsers restrict the ES
modules, textures, and model files that the app needs.

## Interface overview

The app opens at the current UTC date, playing forward at real-time speed. The
Sun's info card is shown initially.

- **Top bar:** live/follow/FPS status, eclipse chooser, View settings, Help, and
  Reset view.
- **Explore panel:** navigator for the Sun, eight planets, five dwarf planets,
  seven moons, and—when a true-scale view is active—Voyager 1 and 2.
- **Info panel:** the selected object's description, physical/orbital values,
  facts, and Focus & follow control.
- **Bottom bar:** play, reverse, Now, the speed slider and presets, the UTC
  simulation clock, and the date picker.
- **3D viewport:** direct mouse, touch, and keyboard navigation.

The Explore and info panels have collapse buttons. On narrow screens, the date
picker, some speed presets, and the eclipse description panel may be hidden to
leave more room for the visualization.

## Move the camera

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Orbit around the target | Left-drag | One-finger drag | — |
| Zoom | Wheel | Two-finger pinch | — |
| Pan | Right-drag | Two-finger drag | — |
| Move forward/back | — | — | `W`/`S` or `↑`/`↓` |
| Move left/right | — | — | `A`/`D` or `←`/`→` |
| Move up/down | — | — | `R`/`F` |

Keyboard flight moves both the camera and its orbit target. Its speed scales
with the current viewing distance, so it remains useful in both compressed and
true-scale views. Starting manual flight stops an active follow.

Use **Reset view** to return to the default framing for the current distance
mode. Resetting Accurate mode returns to the drifting Sun framing.

## Select, inspect, and follow objects

You can interact with the Sun, planets, dwarf planets, moons, and Voyager probes.

1. **Single-click a body or label** to inspect it. The info panel opens and
   expands, but the camera does not begin following it.
2. **Double-click a body** or **double-click/double-tap a label** to focus and
   follow it.
3. Choosing an object from the **Explore** navigator also focuses and follows it.
4. After inspecting an object, use **Focus & follow** in the info panel to begin
   tracking it.

While following, the camera moves with the object but you can still orbit and
zoom around it. Stop following with **Stop following**, `Esc`, or any keyboard
flight key. A new single-click selection also ends the previous follow.

### Read the info panel

The panel contains:

- the object's name and type;
- a short description;
- physical and orbital values;
- mission/status values for Voyager; and
- a **Did you know?** list when facts are available.

Use the chevron in the panel header to collapse or expand the details. Voyager
distance, light-time, speed, and status are evaluated for the simulated date
when the probe is selected. Reselect the probe after moving time to refresh
those displayed values.

## Control simulation time

The normal orrery and the eclipse modes have separate timelines.

| Control | Behavior |
| --- | --- |
| Play/pause | Starts or stops time; `Space` is the keyboard shortcut. |
| Reverse | Switches between forward and backward playback. |
| Speed slider | Logarithmic range from real time to about 10 simulated years per real second. |
| Presets | Real time, 1 hour/s, 1 day/s, 1 week/s, 1 month/s, or 1 year/s. Choosing one resumes playback. |
| Now | Sets the simulation to the current date and time. |
| Go to date | Sets the simulation to 00:00 UTC on the chosen calendar date. |

The UTC simulation clock appears beside the speed readout. Moving the speed
slider, reversing direction, choosing Now, or choosing a date does not itself
resume a paused simulation; speed presets do.

The approximate JPL element/rate model for the eight planets is best supported
for roughly 1800–2050. The app will render other dates, but it is an educational
orrery rather than a precision observing ephemeris.

## Use View settings

Choose **View** in the top bar to open these settings:

| Setting | Effect |
| --- | --- |
| Orbit paths | Shows planetary and enabled moon orbit lines. Locked off in Accurate mode. |
| Labels | Shows or hides clickable object labels. |
| Moons | Shows or hides all seven modeled moons and their orbit lines. |
| Dwarf planets | Shows or hides Pluto, Ceres, Haumea, Makemake, and Eris. |
| Spacecraft (Voyagers) | Shows or hides both probes in Realistic and Accurate modes. |
| Asteroid & Kuiper belts | Shows or hides both GPU-instanced belts. |
| Sun glow (bloom) | Enables or disables selective HDR bloom around the Sun. |
| Fullscreen | Enters browser fullscreen and hides the app chrome for an unobstructed view. |
| Distance scale | Switches among Compressed, Realistic, and Accurate · live. |
| Texture quality | Selects the standard set or the high-resolution set (up to 8K). |
| Language | Selects English or Vietnamese. |

Texture quality and language choices are saved in the browser and reload the
page so the scene can rebuild. The high-resolution set contains maps up to 8K;
individual source maps vary in resolution. Earth and the Milky Way background
use their high-resolution maps in either mode. Fullscreen preserves the other
View settings; exiting browser fullscreen restores the interface.

## Understand the distance modes

### Compressed

This is the default overview. Orbital distances use a nonlinear compression,
the Sun is reduced, and very small dwarf planets are enlarged enough to find.
It is the easiest mode for comparing orbits and moving quickly between objects.
Voyager probes are unavailable because their true distances do not fit this
display scale meaningfully.

### Realistic

Body radii, interplanetary distances, and moon distances share one true-scale
ruler. The Sun becomes a small point, planets become specks, and empty space
dominates the scene. Voyager 1 and 2 become available in the navigator.

Use the Explore list and **Focus & follow** instead of trying to find tiny bodies
manually. Reset view frames the inner system, not the entire distant system.

### Accurate · live

This mode uses the same true-scale orbital model as Realistic, then:

- jumps to the current date;
- resumes forward playback;
- follows the Sun;
- hides and locks orbit paths; and
- adds a shared, stylized drift with fading motion trails.

The drift makes movement through space readable; it is not an absolute galactic
trajectory. Leaving Accurate mode restores the orbit-path setting that was in
use before entry.

## Find Voyager 1 and Voyager 2

1. Open **View** and choose **Realistic** or **Accurate · live**.
2. Ensure **Spacecraft (Voyagers)** is enabled.
3. In the **Spacecraft** section of Explore, choose **Voyager 1** or
   **Voyager 2**.
4. Orbit and zoom after the focus animation finishes. Use the probe's label as
   a locator in the enormous true-scale scene.

The NASA model stays at metre scale rather than being enlarged to planet size.
The renderer rebases the scene around a focused probe so it remains inspectable
at its large heliocentric distance.

Voyager trajectories come from state-vector samples embedded in the app; they
are not fetched from HORIZONS on every visit. The probes are hidden on simulated
dates before their 1977 launches. Use a post-launch date if a probe does not
appear.

## Explore eclipse modes

Choose **Eclipses** in the top bar, then select **Solar Eclipse** or
**Lunar Eclipse**. The normal orrery is temporarily hidden, its camera position
is saved, and a separate 3D teaching scene opens.

Both modes provide:

- a 3D Sun–Earth–Moon alignment and orbit guides;
- umbra and penumbra shadow geometry;
- a **View from Earth's surface** canvas;
- a phase name and percentage readout;
- a looping timeline of about 22 seconds;
- play/pause with the on-screen button or `Space`; and
- a scrubber that pauses playback at the selected phase.

### Solar eclipse

The Moon crosses the Sun in the surface view. Use **Total** to see totality,
including the corona, prominences, Baily's beads, and diamond-ring transition.
Use **Annular** to make the Moon's apparent disk smaller and reveal the ring of
fire at maximum eclipse.

### Lunar eclipse

Earth's penumbra and umbra move across the Moon. The phase display distinguishes
penumbral, partial, and total stages, while the surface view dims the Moon and
turns it copper-red during totality. The Total/Annular selector is intentionally
hidden because it applies only to solar eclipses.

Choose **Exit eclipse** or press `Esc` to restore the orrery and its saved camera
view. Eclipse mode is a didactic visualization, not a prediction for the date
selected in the main simulation.

## Tips for the best experience

- Start in **Compressed** mode to learn the layout, then use **Realistic** for a
  sense of the actual empty space between worlds.
- Use **Focus & follow** before increasing time speed so a moving target stays
  framed.
- Use the standard texture set on integrated graphics, mobile devices, or
  limited-memory systems. Choose the high-resolution set for close-up surface
  detail on capable hardware.
- Disable bloom, belts, labels, orbit paths, moons, or dwarf planets if frame
  rate is low.
- Fullscreen is useful for exploration; the mouse/touch view and keyboard
  controls continue to work while the chrome is hidden.

## Troubleshooting

### The page is blank when opened directly

Do not use `file://`. Start `python server.py` from the repository root and open
the printed `http://127.0.0.1:PORT/` address.

### Textures or the Voyager model do not load

- Confirm the server was started from the project root, where `index.html`,
  `textures/`, and `models/` are siblings.
- Reload the page and check that the loading screen completes.
- Switch back to 2K textures if the 8K set is too large for the device.
- Check the browser developer console for failed asset requests or WebGL errors.

### The browser reports a module MIME-type error

Use the included Python server, which sends JavaScript and CSS with explicit MIME
types. If you use another static server, configure `.js` files as JavaScript.

### The browser or device does not support the app

Use a current Chrome, Edge, or Firefox release with WebGL enabled. Update the
browser and graphics driver if WebGL context creation fails.

### Performance is low

Choose 2K textures, disable Sun bloom and the two belts, hide unnecessary labels
or orbit paths, and close other GPU-heavy tabs. High-resolution textures and
thousands of instanced belt bodies increase GPU memory and rendering work.

### Voyager is missing

Voyager appears only in Realistic or Accurate mode, with the Spacecraft toggle
enabled, and on a simulated date after its launch. Its physical scale is tiny,
so select it from Explore instead of searching visually.

### The interface disappeared

You may be in fullscreen or eclipse mode. Press `Esc` to leave the active mode
and restore the normal interface.
