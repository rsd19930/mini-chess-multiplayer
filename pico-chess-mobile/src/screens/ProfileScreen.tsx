import React from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ImageBackground,
    Image,
    ScrollView,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RouteProp } from "@react-navigation/native";
import { RootStackParamList } from "../types/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getTierForElo, getTierProgress, TIER_THRESHOLDS } from "../utils/elo";
import { FontAwesome5 } from "@expo/vector-icons";

type ProfileScreenNavigationProp = NativeStackNavigationProp<
    RootStackParamList,
    "Profile"
>;
type ProfileScreenRouteProp = RouteProp<RootStackParamList, "Profile">;

interface ProfileScreenProps {
    navigation: ProfileScreenNavigationProp;
    route: ProfileScreenRouteProp;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
    navigation,
    route,
}) => {
    const insets = useSafeAreaInsets();
    const { playerElo, coinBalance, avatarUrl, userName } = route.params;

    const currentTier = getTierForElo(playerElo);
    const { progressPercent, nextTierThreshold } = getTierProgress(playerElo);

    return (
        <View style={styles.container}>
            <ImageBackground
                source={require("../../assets/game-bg.jpg")}
                style={styles.background}
                resizeMode="cover"
            >
                <ScrollView
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 30) },
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Header */}
                    <Text style={styles.headerTitle}>Profile</Text>

                    {/* Player Identity Card — 3D styled */}
                    <View style={styles.card3d}>
                        <View style={styles.identityRow}>
                            {avatarUrl ? (
                                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                            ) : (
                                <View style={styles.avatarStub}>
                                    <FontAwesome5 name="user" size={20} color="#aaa" />
                                </View>
                            )}
                            <Text style={styles.identityName} numberOfLines={1}>{userName}</Text>
                            <View style={styles.coinChip}>
                                <Text style={styles.coinChipText}>🪙 {coinBalance}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Current Tier Card — golden highlight */}
                    <View style={styles.tierCard}>
                        <Text style={styles.sectionLabel}>Current Tier</Text>
                        {/* Elo as the hero number */}
                        <Text style={styles.heroElo}>{playerElo}</Text>
                        <Text style={styles.heroEloSub}>Elo Rating</Text>
                        {/* Tier icon + name as secondary */}
                        <View style={styles.tierSecondaryRow}>
                            <Text style={styles.tierSmallIcon}>{currentTier.icon}</Text>
                            <Text style={styles.tierSmallName}>{currentTier.name}</Text>
                        </View>

                        {/* Progress bar */}
                        {nextTierThreshold !== null ? (
                            <View style={styles.progressWrap}>
                                <View style={styles.progressTrack}>
                                    <View
                                        style={[
                                            styles.progressFill,
                                            {
                                                width: `${progressPercent}%`,
                                                backgroundColor: currentTier.color === "#c0c0c0" ? "#3b82f6" : currentTier.color,
                                            },
                                        ]}
                                    />
                                </View>
                                <View style={styles.progressRow}>
                                    <Text style={styles.progressHint}>Next Tier</Text>
                                    <Text style={styles.progressNums}>{playerElo} / {nextTierThreshold}</Text>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.maxPill}>
                                <Text style={styles.maxPillText}>🏆 Maximum Tier Reached!</Text>
                            </View>
                        )}
                    </View>

                    {/* Tier Ladder — 3D styled */}
                    <View style={styles.card3d}>
                        <Text style={styles.sectionLabel}>Tier Ladder</Text>
                        {TIER_THRESHOLDS.slice()
                            .reverse()
                            .map((tier, idx) => {
                                const isCurrent = currentTier.name === tier.name;
                                return (
                                    <View
                                        key={idx}
                                        style={[
                                            styles.ladderRow,
                                            isCurrent && styles.ladderRowCurrent,
                                        ]}
                                    >
                                        <View style={styles.ladderLeft}>
                                            <Text style={styles.ladderIcon}>{tier.icon}</Text>
                                            <Text
                                                style={[
                                                    styles.ladderName,
                                                    isCurrent && styles.ladderNameCurrent,
                                                ]}
                                            >
                                                {tier.name}
                                            </Text>
                                            {isCurrent && (
                                                <View style={styles.youBadge}>
                                                    <Text style={styles.youBadgeText}>YOU</Text>
                                                </View>
                                            )}
                                        </View>
                                        <Text
                                            style={[
                                                styles.ladderBounds,
                                                isCurrent && styles.ladderBoundsCurrent,
                                            ]}
                                        >
                                            {tier.min}{tier.max ? `–${tier.max}` : "+"}
                                        </Text>
                                    </View>
                                );
                            })}
                    </View>

                    {/* Back to Home */}
                    <TouchableOpacity
                        style={styles.homeBtn}
                        onPress={() => navigation.goBack()}
                    >
                        <Text style={styles.homeBtnText}>Back to Home</Text>
                    </TouchableOpacity>
                </ScrollView>
            </ImageBackground>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#d4e4db",
    },
    background: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 20,
    },

    /* ─── Header ─── */
    headerTitle: {
        fontSize: 24,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
        textAlign: "center",
        marginBottom: 20,
        textShadowColor: "rgba(255,255,255,0.6)",
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
    },

    /* ─── 3D Card (shared base) ─── */
    card3d: {
        backgroundColor: "rgba(255, 255, 255, 0.7)",
        borderRadius: 24,
        borderWidth: 2,
        borderBottomWidth: 6,
        borderColor: "rgba(0, 0, 0, 0.08)",
        padding: 16,
        marginBottom: 14,
    },

    /* ─── Identity ─── */
    identityRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 2,
        borderColor: "rgba(0,0,0,0.1)",
    },
    avatarStub: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: "rgba(0,0,0,0.06)",
        alignItems: "center",
        justifyContent: "center",
    },
    identityName: {
        flex: 1,
        fontSize: 20,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
        marginLeft: 14,
    },
    coinChip: {
        backgroundColor: "rgba(0,0,0,0.05)",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(0,0,0,0.06)",
    },
    coinChipText: {
        fontSize: 16,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
    },

    /* ─── Current Tier ─── */
    sectionLabel: {
        fontSize: 14,
        fontFamily: "PublicSans_700Bold",
        color: "#475569",
        marginBottom: 7,
    },
    tierCard: {
        backgroundColor: "#ffffff",
        borderRadius: 24,
        borderWidth: 3,
        borderBottomWidth: 6,
        borderColor: "#facc15",
        padding: 12,
        marginBottom: 14,
        elevation: 4,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        alignItems: "center",
    },
    heroElo: {
        fontSize: 48,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
        marginBottom: 0,
    },
    heroEloSub: {
        fontSize: 14,
        fontFamily: "PublicSans_400Regular",
        color: "#475569",
        marginBottom: 12,
    },
    tierSecondaryRow: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.04)",
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 14,
        marginBottom: 14,
    },
    tierSmallIcon: {
        fontSize: 18,
        marginRight: 6,
    },
    tierSmallName: {
        fontSize: 15,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
    },
    progressWrap: {
        width: "100%",
    },
    progressTrack: {
        height: 12,
        backgroundColor: "rgba(0,0,0,0.06)",
        borderRadius: 6,
        overflow: "hidden",
        marginBottom: 6,
    },
    progressFill: {
        height: "100%",
        borderRadius: 6,
    },
    progressRow: {
        flexDirection: "row",
        justifyContent: "space-between",
    },
    progressHint: {
        fontSize: 12,
        fontFamily: "PublicSans_400Regular",
        color: "#64748b",
    },
    progressNums: {
        fontSize: 12,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
    },
    maxPill: {
        backgroundColor: "rgba(0,0,0,0.04)",
        borderRadius: 12,
        paddingVertical: 10,
        alignItems: "center",
    },
    maxPillText: {
        color: "#ca8a04",
        fontFamily: "PublicSans_700Bold",
        fontSize: 14,
    },

    /* ─── Tier Ladder ─── */
    ladderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 14,
        marginBottom: 4,
    },
    ladderRowCurrent: {
        backgroundColor: "rgba(0, 0, 0, 0.06)",
        borderWidth: 1.5,
        borderColor: "rgba(0, 0, 0, 0.1)",
    },
    ladderLeft: {
        flexDirection: "row",
        alignItems: "center",
    },
    ladderIcon: {
        fontSize: 22,
        marginRight: 10,
    },
    ladderName: {
        fontSize: 15,
        fontFamily: "PublicSans_700Bold",
        color: "#475569",
    },
    ladderNameCurrent: {
        color: "#2A343A",
        fontFamily: "PublicSans_700Bold",
    },
    youBadge: {
        backgroundColor: "#3b82f6",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        marginLeft: 8,
    },
    youBadgeText: {
        color: "#ffffff",
        fontFamily: "PublicSans_700Bold",
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: 1,
    },
    ladderBounds: {
        fontSize: 14,
        fontFamily: "PublicSans_400Regular",
        color: "#64748b",
    },
    ladderBoundsCurrent: {
        color: "#2A343A",
        fontFamily: "PublicSans_700Bold",
    },

    /* ─── Bottom Button ─── */
    homeBtn: {
        backgroundColor: "#2980b9",
        borderWidth: 2,
        borderBottomWidth: 6,
        borderColor: "#1c5980",
        paddingVertical: 14,
        borderRadius: 24,
        alignItems: "center",
        marginTop: 4,
        marginBottom: 10,
    },
    homeBtnText: {
        color: "#ffffff",
        fontFamily: "PublicSans_700Bold",
        fontSize: 16,
    },
});
