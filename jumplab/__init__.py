"""JumpLab: standing broad jump biomechanics from a single side-on phone video.

Modules
    pose_tracking  single MediaPipe pass -> raw keypoints (+ skeleton overlay video)
    calibration    click two points a known distance apart -> meters per pixel
    smoothing      gap filling + zero-lag Butterworth low-pass filter
    angles         trunk / shin angles from vertical, joint angle from 3 points
    events         takeoff, landing, countermovement bottom, movement onset
    physics        projectile fit (vx, vy, launch angle, g check), flight-time formulas
    ball_tracking  track a tossed/dropped ball, for validating the physics + calibration
    pipeline       ties it together: video or keypoints in -> results dict out
    report         printed summary, CSV and JSON output
    plotting       event and trajectory plots
"""
