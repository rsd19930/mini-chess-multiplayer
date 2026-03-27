import { Audio } from "expo-av";

export class AudioService {
  private static moveSound: Audio.Sound | null = null;
  private static captureSound: Audio.Sound | null = null;
  private static dropSound: Audio.Sound | null = null;
  private static checkSound: Audio.Sound | null = null;
  private static checkmateSound: Audio.Sound | null = null;
  private static gameEndSound: Audio.Sound | null = null;
  private static gameStartSound: Audio.Sound | null = null;

  private static opponentMoveSound: Audio.Sound | null = null;
  private static opponentCaptureSound: Audio.Sound | null = null;
  private static opponentDropSound: Audio.Sound | null = null;

  private static tenSecsSound: Audio.Sound | null = null;

  static async preloadSounds() {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
      });

      const results = await Promise.allSettled([
        Audio.Sound.createAsync(require("../../assets/sounds/move_step.wav")),
        Audio.Sound.createAsync(
          require("../../assets/sounds/piece_capture.wav"),
        ),
        Audio.Sound.createAsync(require("../../assets/sounds/piece_drop.wav")),
        Audio.Sound.createAsync(require("../../assets/sounds/check.wav")),
        Audio.Sound.createAsync(require("../../assets/sounds/checkmate.wav")),
        Audio.Sound.createAsync(require("../../assets/sounds/game_end.wav")),
        Audio.Sound.createAsync(require("../../assets/sounds/game_start.wav")),
        Audio.Sound.createAsync(
          require("../../assets/sounds/opponent_moves_piece.mp3"),
        ),
        Audio.Sound.createAsync(
          require("../../assets/sounds/opponent_captures_piece.mp3"),
        ),
        Audio.Sound.createAsync(
          require("../../assets/sounds/opponent_drops_piece_from_hand.mp3"),
        ),
        Audio.Sound.createAsync(
          require("../../assets/sounds/ten_secs_remaining.mp3"),
        ),
      ]);

      const getSound = (res: PromiseSettledResult<{ sound: Audio.Sound }>) => {
        if (res.status === "fulfilled") {
          return res.value.sound;
        } else {
          console.warn("Audio failed to load:", res.reason);
          return null;
        }
      };

      this.moveSound = getSound(results[0]);
      this.captureSound = getSound(results[1]);
      this.dropSound = getSound(results[2]);
      this.checkSound = getSound(results[3]);
      this.checkmateSound = getSound(results[4]);
      this.gameEndSound = getSound(results[5]);
      this.gameStartSound = getSound(results[6]);
      this.opponentMoveSound = getSound(results[7]);
      this.opponentCaptureSound = getSound(results[8]);
      this.opponentDropSound = getSound(results[9]);
      this.tenSecsSound = getSound(results[10]);
    } catch (err) {
      console.warn("Audio assets not found, using silent stub", err);
    }
  }

  private static async replaySafe(sound: Audio.Sound | null) {
    if (sound) {
      try {
        await sound.replayAsync();
      } catch (e) {
        console.warn("Audio replay failed", e);
      }
    }
  }

  static async playMove() {
    await this.replaySafe(this.moveSound);
  }

  static async playCapture() {
    await this.replaySafe(this.captureSound);
  }

  static async playDrop() {
    await this.replaySafe(this.dropSound);
  }

  static async playCheck() {
    await this.replaySafe(this.checkSound);
  }

  static async playCheckmate() {
    await this.replaySafe(this.checkmateSound);
  }

  static async playGameEnd() {
    await this.replaySafe(this.gameEndSound);
  }

  static async playGameStart() {
    await this.replaySafe(this.gameStartSound);
  }

  static async playOpponentMove() {
    await this.replaySafe(this.opponentMoveSound);
  }

  static async playOpponentCapture() {
    await this.replaySafe(this.opponentCaptureSound);
  }

  static async playOpponentDrop() {
    await this.replaySafe(this.opponentDropSound);
  }

  static async playTenSecsWarning() {
    await this.replaySafe(this.tenSecsSound);
  }
}
