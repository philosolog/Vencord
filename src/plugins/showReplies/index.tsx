/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { DownArrow, RightArrow } from "@components/Icons";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelStore, MessageActions, MessageStore, RelationshipStore, useLayoutEffect, useRef, useState, useStateFromStores } from "@webpack/common";

const ChannelMessage = findComponentByCodeLazy("childrenExecutedCommand:", ".hideAccessories");
const MessageDisplayCompact = getUserSettingLazy("textAndImages", "messageDisplayCompact")!;
const IsInlineReply = Symbol();

interface ReplyNode {
    message: Message;
    replies: ReplyNode[];
}

const settings = definePluginSettings({
    maxDepth: {
        description: "Maximum reply nesting depth",
        type: OptionType.SLIDER,
        markers: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        default: 0,
        stickToMarkers: true,
        componentProps: {
            onValueRender: (value: number) => value === 0 ? "∞" : String(value),
            onMarkerRender: (value: number) => value === 0 ? "∞" : String(value)
        }
    }
});

function getReplyTree(message: Message, maxDepth: number) {
    const messages = MessageStore.getMessages(message.channel_id);
    const allMessages = messages._array as Message[] | undefined;
    const repliesByParent = new Map<string, Message[]>();

    for (const reply of allMessages ?? []) {
        const parentId = reply.messageReference?.message_id;
        if (!parentId) continue;

        const replies = repliesByParent.get(parentId);
        if (replies) replies.push(reply);
        else repliesByParent.set(parentId, [reply]);
    }

    const build = (parentId: string, depth: number, seen = new Set<string>()): ReplyNode[] => {
        if (maxDepth && depth >= maxDepth) return [];

        return (repliesByParent.get(parentId) ?? []).flatMap(reply => {
            if (seen.has(reply.id)) return [];
            const nextSeen = new Set(seen).add(reply.id);

            if (RelationshipStore.isBlockedOrIgnored(reply.author.id))
                return build(reply.id, depth, nextSeen);

            return [{
                message: reply,
                replies: build(reply.id, depth + 1, nextSeen)
            }];
        });
    };

    return build(message.id, 0);
}

function withoutReplyHeader(message: Message): Message {
    return new Proxy(message, {
        get(target, prop, receiver) {
            if (prop === "messageReference") return undefined;
            if (prop === IsInlineReply) return true;

            return Reflect.get(target, prop, receiver);
        }
    });
}

function ReplyThreadNode({ node, compact }: { node: ReplyNode; compact: boolean; }) {
    const [collapsed, setCollapsed] = useState(true);
    const [branchTop, setBranchTop] = useState<number>();
    const [branchLeft, setBranchLeft] = useState(20);
    const messageRef = useRef<HTMLDivElement>(null);
    const channel = ChannelStore.getChannel(node.message.channel_id);
    const childCount = node.replies.length;
    const BranchArrow = collapsed ? RightArrow : DownArrow;

    useLayoutEffect(() => {
        const messageElement = messageRef.current;
        if (!childCount || !messageElement) return;

        const updateBranchPosition = () => {
            const content = messageElement.querySelector<HTMLElement>("[class*='messageContent']");
            if (!content) {
                setBranchTop(undefined);
                setBranchLeft(20);
                return;
            }

            const lineHeight = parseFloat(getComputedStyle(content).lineHeight);
            const contentRect = content.getBoundingClientRect();
            const messageRect = messageElement.getBoundingClientRect();
            const multiline = contentRect.height > lineHeight * 1.5;

            setBranchLeft(contentRect.left - messageRect.left);
            setBranchTop(multiline
                ? contentRect.bottom - messageRect.top
                : undefined);
        };

        updateBranchPosition();

        const observer = new ResizeObserver(updateBranchPosition);
        observer.observe(messageElement);
        return () => observer.disconnect();
    }, [childCount, compact, node.message.content]);

    if (!channel) return null;

    return (
        <div className={`vc-show-replies-node${!collapsed && childCount ? " vc-show-replies-node-expanded" : ""}`}>
            <div className="vc-show-replies-message" ref={messageRef}>
                <button
                    type="button"
                    className="vc-show-replies-jump"
                    aria-label="Jump to reply"
                    onClick={e => {
                        e.stopPropagation();
                        MessageActions.jumpToMessage({
                            channelId: node.message.channel_id,
                            messageId: node.message.id,
                            flash: true
                        });
                    }}
                >
                    <DownArrow />
                </button>
                <ChannelMessage
                    id={`show-replies-${node.message.id}`}
                    message={withoutReplyHeader(node.message)}
                    channel={channel}
                    compact={compact}
                    subscribeToComponentDispatch={true}
                />
                {!!childCount && branchTop != null && (
                    <button
                        type="button"
                        className="vc-show-replies-branch-toggle vc-show-replies-branch-toggle-inline"
                        style={{ top: branchTop }}
                        aria-label={`${collapsed ? "Show" : "Hide"} ${childCount} ${childCount === 1 ? "reply" : "replies"}`}
                        aria-expanded={!collapsed}
                        onClick={e => {
                            e.stopPropagation();
                            setCollapsed(value => !value);
                        }}
                    >
                        <BranchArrow />
                        {childCount}
                    </button>
                )}
            </div>
            {!!childCount && branchTop == null && (
                <button
                    type="button"
                    className="vc-show-replies-branch-toggle"
                    style={{ marginLeft: branchLeft }}
                    aria-expanded={!collapsed}
                    onClick={e => {
                        e.stopPropagation();
                        setCollapsed(value => !value);
                    }}
                >
                    {collapsed ? "Show" : "Hide"} {childCount} {childCount === 1 ? "reply" : "replies"}
                </button>
            )}
            {!collapsed && !!childCount && (
                <div className="vc-show-replies-children">
                    {node.replies.map(reply => (
                        <ReplyThreadNode
                            key={reply.message.id}
                            node={reply}
                            compact={compact}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ShowRepliesAccessory({ message }: { message: Message; }) {
    const [open, setOpen] = useState(false);
    const compact = MessageDisplayCompact.useSetting();
    const { maxDepth } = settings.use(["maxDepth"]);
    const replies = useStateFromStores([MessageStore, RelationshipStore], () => getReplyTree(message, maxDepth));
    const replyCount = replies.length;

    if (!replyCount) return null;

    return (
        <div className="vc-show-replies">
            <button
                type="button"
                className="vc-show-replies-toggle"
                onClick={e => {
                    e.stopPropagation();
                    setOpen(value => !value);
                }}
                aria-expanded={open}
            >
                {open ? "Hide" : "View"} {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </button>
            {open && (
                <div className="vc-show-replies-thread">
                    {replies.map(reply => (
                        <ReplyThreadNode
                            key={reply.message.id}
                            node={reply}
                            compact={compact}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
export default definePlugin({
    name: "ShowReplies",
    description: "Adds a button to expose a message's replies",
    authors: [Devs.philosolog],
    tags: ["Chat", "Appearance"],
    settings,
    restartNeeded: true,
    renderMessageAccessory({ message }) {
        if (message[IsInlineReply] || message.type !== 0 && message.type !== 19) return null;

        return <ShowRepliesAccessory message={message} />;
    }
});
