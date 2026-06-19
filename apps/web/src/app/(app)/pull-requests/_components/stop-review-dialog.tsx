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
    onConfirm: () => void | Promise<void>;
    isPending?: boolean;
}

export function StopReviewDialog({
    open,
    onOpenChange,
    onConfirm,
    isPending = false,
}: StopReviewDialogProps) {
    const handleConfirm = async () => {
        if (isPending) {
            return;
        }

        try {
            await Promise.resolve(onConfirm());
        } finally {
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Stop this review?</DialogTitle>
                    <DialogDescription>
                        Kody will stop analyzing this PR. This cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="cancel"
                        size="md"
                        onClick={() => onOpenChange(false)}
                        disabled={isPending}>
                        Keep running
                    </Button>
                    <Button
                        type="button"
                        variant="error"
                        size="md"
                        loading={isPending}
                        onClick={() => {
                            void handleConfirm();
                        }}>
                        Stop review
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
