"use client";

import { Button } from "@components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@components/ui/dialog";

interface StopReviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    isPending?: boolean;
}

export function StopReviewDialog({
    open,
    onOpenChange,
    onConfirm,
    isPending = false,
}: StopReviewDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Stop this review?</DialogTitle>
                    <DialogDescription>
                        Kody will stop analyzing this PR. This cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex flex-row justify-end gap-2">
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={() => onOpenChange(false)}
                        disabled={isPending}>
                        Keep running
                    </Button>
                    <Button
                        type="button"
                        variant="error"
                        onClick={onConfirm}
                        disabled={isPending}>
                        {isPending ? "Stopping..." : "Stop review"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
