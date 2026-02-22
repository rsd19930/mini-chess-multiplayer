import { Audio } from 'expo-av';

export class AudioService {
    private static moveSound: Audio.Sound | null = null;
    private static captureSound: Audio.Sound | null = null;
    private static dropSound: Audio.Sound | null = null;
    private static checkSound: Audio.Sound | null = null;
    private static checkmateSound: Audio.Sound | null = null;
    private static gameEndSound: Audio.Sound | null = null;
    private static gameStartSound: Audio.Sound | null = null;

    static async initialize() {
        try {
            await Audio.setAudioModeAsync({
                playsInSilentModeIOS: true,
            });

            const [{ sound: move }, { sound: capture }, { sound: drop }, { sound: check }, { sound: checkmate }, { sound: gameEnd }, { sound: gameStart }] = await Promise.all([
                Audio.Sound.createAsync(require('../../assets/sounds/move_step.wav')),
                Audio.Sound.createAsync(require('../../assets/sounds/piece_capture.wav')),
                Audio.Sound.createAsync(require('../../assets/sounds/piece_drop.wav')),
                Audio.Sound.createAsync(require('../../assets/sounds/check.wav')),
                Audio.Sound.createAsync(require('../../assets/sounds/checkmate.wav')),
                Audio.Sound.createAsync(require('../../assets/sounds/game_end.wav')),
                Audio.Sound.createAsync(require('../../assets/sounds/game_start.wav'))
            ]);

            this.moveSound = move;
            this.captureSound = capture;
            this.dropSound = drop;
            this.checkSound = check;
            this.checkmateSound = checkmate;
            this.gameEndSound = gameEnd;
            this.gameStartSound = gameStart;

        } catch (err) {
            console.warn('Audio assets not found, using silent stub', err);
        }
    }

    private static async replaySafe(sound: Audio.Sound | null) {
        if (sound) {
            try {
                await sound.replayAsync();
            } catch (e) {
                console.warn('Audio replay failed', e);
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
}
