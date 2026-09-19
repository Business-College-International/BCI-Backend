            guardianId: guardian.personId,
            amount: requestedAmount,
            purpose: PaymentPurpose.FEE,
            status: PaymentStatus.PENDING,
            clientReference,
            idempotencyKey,
          },
        });

        let remaining = requestedAmount;
        const allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: string }> = [];
        const intents: Array<{ id: string; invoiceId: string; amount: string; expiresAt: string }> = [];
        const expiresAt = new Date(Date.now() + PAYMENT_INTENT_TTL_MS);
        for (const item of availableByInvoice) {
          if (remaining.lte(0)) break;
          const amount = Prisma.Decimal.min(remaining, item.available);
          const intent = await tx.paymentIntent.create({
            data: {
              studentId,
              invoiceId: item.invoice.id,
              amount,
              currency: payment.currency,
              status: 'PENDING',
              initiatedByUserId: actorUserId,
              provider: this.moolre.provider,
              clientReference,
              idempotencyKey,
              paymentId: payment.id,
              expiresAt,
            },
            select: { id: true, invoiceId: true, amount: true, expiresAt: true },
          });
          allocations.push({
            invoiceId: item.invoice.id,
            invoiceNumber: item.invoice.invoiceNumber,
            amount: amount.toFixed(2),
          });
          intents.push({
            id: intent.id,
            invoiceId: intent.invoiceId,
            amount: intent.amount.toFixed(2),
            expiresAt: intent.expiresAt.toISOString(),
          });
          remaining = remaining.minus(amount);
        }

        const attempt = await tx.paymentProviderAttempt.create({
          data: {
            paymentId: payment.id,
            provider: this.moolre.provider,
            status: PaymentStatus.PENDING,
          },
        });