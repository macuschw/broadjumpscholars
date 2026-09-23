# JumpLab

Broad jump biomechanics analysis from a single phone camera.

## Setup
1. Install Python
2. Install dependencies: `pip install -r requirements.txt`
   (on Windows you usually don't need `--break-system-packages`; add it only if pip complains)
3. Put a test video in this folder named `test_jump.mp4` (not tracked by Git — see .gitignore)
4. Create an `output` folder if it doesn't exist: `mkdir output`
5. Run: `python track_pose.py`
6. Open `output/tracked_jump.mp4` to check the skeleton overlay, especially the feet
