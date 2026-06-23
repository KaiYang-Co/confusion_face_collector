# Facial Confusion Data Collector

This is a local, face-only data collection tool for training a confusion
detection model. It records:

- webcam video without audio;
- confusion intervals marked by holding and releasing Space;
- the reading material and multiple-choice questions;
- participant answers and session metadata.

Tobii eye tracking is not required. The user interface and exported
documentation are in English.

## Start

Double-click `start.cmd`. The browser opens:

```text
http://127.0.0.1:8765
```

Allow camera access when prompted. If the page opens before the local server is
ready, wait one second and refresh it.

## Collection procedure

1. Enter the participant ID and reading ID.
2. Paste the reading text or import a `.txt` file.
3. Add any multiple-choice questions.
4. Select **Confirm Reading and Questions**.
5. Select **Start Collection**.
6. The participant reads and answers the questions.
7. The participant holds Space for the full period in which they feel
   confused, then releases Space when the confusion ends.
8. Select **Stop and Save**.

The **Hold to Mark Confusion** button provides the same press-and-hold behavior
for mouse or touch input. **Undo Last Interval** removes the latest completed
interval.

## Output directory

Each collection creates one directory under `data`:

```text
data/
└─ S01_Text01_20260623_153012_ab12/
   ├─ face.webm
   ├─ confusion_intervals.csv
   ├─ confusion_intervals.json
   └─ metadata.json
```

The browser may produce `face.mp4` instead of `face.webm` if MP4 recording is
supported and selected.

## Confusion interval schema

Example `confusion_intervals.csv`:

```csv
event_id,start_time_ms,end_time_ms,duration_ms,start_recorded_at_iso,end_recorded_at_iso,input_source,end_reason
1,14200,15840,1640,2026-06-23T06:30:14.200Z,2026-06-23T06:30:15.840Z,keyboard_space,space_released
2,38600,40110,1510,2026-06-23T06:30:38.600Z,2026-06-23T06:30:40.110Z,keyboard_space,space_released
```

`start_time_ms` and `end_time_ms` are measured from the start of the video
recording using `performance.now()`.

Possible `input_source` values:

- `keyboard_space`
- `hold_button`

Possible `end_reason` values:

- `space_released`
- `button_released`
- `collection_stopped`
- `window_blurred`
- `pointer_cancelled`

If collection stops or the browser loses focus during an active interval, the
collector closes that interval automatically and records the reason.

## Reading material templates

Confirmed reading materials are stored in the browser's local storage.

- **Load** restores a selected local template.
- **Delete** removes it from local storage.
- **Export JSON** saves it as a transferable file.
- **Import JSON** loads a previously exported template.

Export templates before changing browser, changing computer, or clearing
browser data.

## Notes

- Do not close the page before selecting **Stop and Save**.
- The saved video contains no audio.
- The preview is mirrored for the participant; the saved stream follows the
  camera's original output.
- Holding Space produces a stronger interval label than a single keypress, but
  human recognition and motor-response latency can still shift the reported
  interval relative to the earliest facial evidence of confusion.
- Keep train, validation, and test data separated by participant ID.

## Technical structure

- Front end: plain HTML, CSS, and JavaScript
- Recording: browser `MediaRecorder`
- Relative timestamps: `performance.now()`
- Local service: Node.js built-in modules
- Third-party dependencies: none
