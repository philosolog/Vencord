/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    voiceBitrate: {
        type: OptionType.SLIDER,
        description: "Minimum outgoing voice bitrate",
        markers: [64, 96, 128, 192, 256, 384, 512],
        default: 128,
        stickToMarkers: false,
        restartNeeded: true,
        componentProps: {
            onValueRender: (value: number) => `${Math.floor(value)} kbps`
        }
    },
    forwardErrorCorrection: {
        type: OptionType.BOOLEAN,
        description: "Keep Opus forward error correction enabled for packet-loss resilience",
        default: true,
        restartNeeded: true
    }
});

export default definePlugin({
    name: "VoiceQuality",
    description: "Raises outgoing Opus bitrate while keeping Discord's stable mono voice path",
    tags: ["Voice"],
    authors: [Devs.philosolog],
    enabledByDefault: true,
    settings,

    patches: [
        {
            find: "...this.getAttenuationOptions()",
            replacement: [
                {
                    match: /freq:48e3,pacsize:960,channels:1,rate:64e3/,
                    replace: "freq:48e3,pacsize:960,channels:1,rate:$self.getBitrate()"
                },
                {
                    match: /setBitRate\((\i)\)\{this\.setVoiceBitRate\(\1\)\}/,
                    replace: "setBitRate($1){$self.setVoiceBitrate(this,$1)}"
                },
                {
                    match: /fec:!0/,
                    replace: "fec:$self.isFecEnabled()"
                }
            ]
        }
    ],

    getBitrate() {
        return Math.floor(settings.store.voiceBitrate * 1000);
    },

    setVoiceBitrate(voiceEngine: { setVoiceBitRate(bitrate: number): void; }, requestedBitrate: number) {
        voiceEngine.setVoiceBitRate(Math.max(requestedBitrate, this.getBitrate()));
    },

    isFecEnabled() {
        return settings.store.forwardErrorCorrection;
    }
});
