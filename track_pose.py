import cv2
import mediapipe as mp

# CHANGE THIS to your video's filename
INPUT_VIDEO = "test_jump.mp4"
OUTPUT_VIDEO = "output/tracked_jump.mp4"

mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils

pose = mp_pose.Pose(static_image_mode=False, model_complexity=1)

cap = cv2.VideoCapture(INPUT_VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

fourcc = cv2.VideoWriter_fourcc(*"mp4v")
out = cv2.VideoWriter(OUTPUT_VIDEO, fourcc, fps, (width, height))

frame_count = 0
detected_count = 0

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame_count += 1
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = pose.process(rgb)

    if results.pose_landmarks:
        detected_count += 1
        mp_drawing.draw_landmarks(
            frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS
        )

    out.write(frame)

cap.release()
out.release()

print(f"Video: {INPUT_VIDEO}")
print(f"FPS: {fps}")
print(f"Total frames: {frame_count}")
print(f"Frames with a person detected: {detected_count} ({100*detected_count/frame_count:.1f}%)")
print(f"Saved tracked video to: {OUTPUT_VIDEO}")
