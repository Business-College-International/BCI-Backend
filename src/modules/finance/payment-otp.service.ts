        },
      });

      return {
        payment,
        attemptId: attempt.id,
        payer,
        network: selectedNetwork,
        sessionId: dto.sessionId ?? storedSessionId,
        responsePayload,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    });

    if ('existing' in reservation) return reservation.existing;

    let providerResult: Awaited<ReturnType<MoolreAdapter['submitPaymentOtp']>>;
    try {
      providerResult = await this.moolre.submitPaymentOtp({
        clientReference: reservation.payment.clientReference!,
        amount: reservation.payment.amount.toFixed(2),
        currency: reservation.payment.currency,
        payer: reservation.payer,
        network: reservation.network,
        otpCode: dto.otpCode,
        sessionId: reservation.sessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Moolre OTP submission failed.';
      if (error instanceof BadRequestException) {
        await this.prisma.$transaction(async (tx) => {
          await tx.paymentProviderAttempt.update({
            where: { id: reservation.attemptId },
            data: {
              status: PaymentStatus.FAILED,
              resolvedAt: new Date(),
              failureCode: 'OTP_SUBMISSION_FAILED',
              failureMessage: message,
            },
          });
          await tx.paymentIntent.updateMany({
            where: { paymentId: payment.id, status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } },
            data: { status: 'FAILED', failureCode: 'OTP_SUBMISSION_FAILED', failureMessage: message, completedAt: new Date() },
          });
          await tx.idempotencyKey.update({
            where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey.trim(), operation: 'payments.otp' } },
            data: {
              responseJson: { paymentId, status: PaymentStatus.PROCESSING, retryable: true },
              statusCode: 400,
              completedAt: new Date(),
            },
          });
        });
        throw error;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.paymentIntent.updateMany({
          where: { paymentId: reservation.payment.id, status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } },
          data: { status: 'PROCESSING', failureCode: 'OTP_SUBMISSION_UNKNOWN', failureMessage: 'OTP submission outcome is unknown; awaiting webhook reconciliation.', completedAt: null },
        });
        await tx.paymentProviderAttempt.updateMany({
          where: {
            id: reservation.attemptId,
            status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
          },
          data: {
            status: PaymentStatus.PROCESSING,
            resolvedAt: null,
            failureCode: 'OTP_SUBMISSION_UNKNOWN',
            failureMessage: 'OTP submission outcome is unknown; awaiting webhook reconciliation.',
            responsePayload: {
              ...reservation.responsePayload,
              otpOutcomeUnknown: true,
            },
          },
        });
      });

      throw new ServiceUnavailableException('OTP submission outcome is unknown; the payment remains processing and requires webhook reconciliation.');
    }

    const response = {
      paymentId: reservation.payment.id,
      clientReference: reservation.payment.clientReference,
      status: PaymentStatus.PROCESSING,
      provider: this.moolre.provider,
      providerReference: providerResult.providerReference,
      requiresOtp: providerResult.requiresOtp,
      mock: providerResult.mock,
      sessionId: providerResult.sessionId ?? reservation.sessionId ?? null,
      network: reservation.network,
    };

    const persistAcceptedResult = async () => this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: reservation.payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
        data: {
          status: PaymentStatus.PROCESSING,
          provider: this.moolre.provider,
          providerReference: providerResult.providerReference ?? reservation.payment.providerReference,
        },
      });
      await tx.paymentIntent.updateMany({
        where: { paymentId: reservation.payment.id, status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } },
        data: { status: 'PROCESSING', provider: this.moolre.provider, providerReference: providerResult.providerReference },
      });
      await tx.paymentProviderAttempt.updateMany({
        where: { id: reservation.attemptId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
        data: {
          status: PaymentStatus.PROCESSING,
          providerReference: providerResult.providerReference,
          responsePayload: response,
          resolvedAt: providerResult.requiresOtp ? null : new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'Payment',
          entityId: reservation.payment.id,
          afterJson: {
            status: PaymentStatus.PROCESSING,
            otpContinuation: true,
            requiresOtp: providerResult.requiresOtp,
            providerReference: providerResult.providerReference,
          },
        },
      });
      await tx.idempotencyKey.update({
        where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey.trim(), operation: 'payments.otp' } },
        data: {
          responseJson: response,
          statusCode: 202,
          completedAt: new Date(),
        },
      });
    });

    try {
      await persistAcceptedResult();
      return response;
    } catch {
      try {
        await persistAcceptedResult();
        return response;
      } catch {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.payment.updateMany({
              where: { id: reservation.payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
              data: {
                status: PaymentStatus.PROCESSING,
                provider: this.moolre.provider,
                providerReference: providerResult.providerReference ?? reservation.payment.providerReference,
              },
            });
            await tx.paymentIntent.updateMany({
              where: { paymentId: reservation.payment.id, status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } },
              data: { status: 'PROCESSING', provider: this.moolre.provider, providerReference: providerResult.providerReference, failureCode: 'OTP_LOCAL_PERSISTENCE_UNKNOWN', failureMessage: 'Provider accepted the OTP, but local settlement state is unknown; reconcile before retrying.', completedAt: null },
            });
            await tx.paymentProviderAttempt.updateMany({
              where: { id: reservation.attemptId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },