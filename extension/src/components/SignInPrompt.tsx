"use client"

import { JUICE } from "~/theme/juice"
import { alpha, Box, Button, TextField, Typography, useTheme } from "@mui/material"
import { MuiOtpInput } from 'mui-one-time-password-input'
import { useEffect, useState } from "react"
import { z } from "zod"
import { useToast } from "~/components/Toast/ToastProvider"
import { CreateProfileStep } from "~/entries/welcome/components/steps/CreateProfileStep"
import { useOtp } from "~/hooks/useOtp"
import type { User } from "~/services/UserService"
import { useAppConfigStore } from "~/store/useAppConfigStore"
import { useUIStore } from "~/store/useUIStore"

type OrganizationInfo = {
  badgeUrl?: string
  // Add other organization properties as needed
}

const logoRight = new URL("~/assets/logo-right.png", import.meta.url).toString()


const emailSchema = z.string().email("Please enter a valid email address")

const sendMessage = (message: any, error?: any, data?: any) => {
  const messanger = window.top ?? window.parent
  return messanger.postMessage(
    {
      type: message,
      message: error,
      data: data,
    }, // Message data
    "*", // Target origin ('*' allows sending to any origin)
  )
}

export default function SignInPrompt({ refetchCurrentUser, user }: { refetchCurrentUser: () => void, user?: User }) {
  
  // Form states
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [otp, setOtp] = useState('')
  const [showCreateProfileStep, setShowCreateProfileStep] = useState(false)


  useEffect(() => {
    if(user && !user.username) {
      setShowCreateProfileStep(true)
    }
  }, [user])

  // OTP hook
  const {
    sendOtp,
    verifyOtp,
    resendOtp,
    resendTimer,
    setResendTimer,
    sendOtpLoading,
    sendOtpError,
    sendOtpSuccess,
    sendOtpData,
    verifyOtpLoading,
    verifyOtpError,
    verifyOtpSuccess,
    verifyOtpData,
  } = useOtp()

  const { showToast } = useToast()


  const { organization } = useAppConfigStore()


  const poppinId = organization?.id

  // Countdown timer effect
  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer(prev => prev - 1)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [resendTimer, setResendTimer])

  // Handle send OTP success/error
  useEffect(() => {
    if (sendOtpSuccess && sendOtpData?.success) {
      setStep('otp')
      showToast(sendOtpData.message || 'OTP sent to your email address', 'success')
    }
  }, [sendOtpSuccess, sendOtpData, showToast])

  useEffect(() => {
    if (sendOtpError) {
      showToast(sendOtpError, 'error')
    }
  }, [sendOtpError, showToast])

  // Handle verify OTP success/error
  useEffect(() => {
    if (verifyOtpSuccess && verifyOtpData) {
      if (verifyOtpData.success !== undefined && !verifyOtpData.success) {
        // Handle error cases similar to Google sign-in
        if (verifyOtpData.status === 401) {
          showToast(verifyOtpData.error, 'error')
          sendMessage("ACCOUNT_NOT_FOUND", verifyOtpData.error, "57")
          return
        }
        // Handle all other error status codes (400, 500, etc.)
        sendMessage("AUTH_ERROR", verifyOtpData.error, verifyOtpData.status?.toString() || "unknown")
        showToast(verifyOtpData.error, 'error')
        return
      }

      if (verifyOtpData.success) {
        if (verifyOtpData?.user?.username) {
          sendMessage("AUTH_SUCCESS")
          showToast("You're ready to go!", 'success')
          refetchCurrentUser()
          useUIStore.getState().setIsSignInModalOpen(false)
        } else {
          sendMessage("AUTH_CREATE_USER")
          setShowCreateProfileStep(true)
        }
      }
    }
  }, [verifyOtpSuccess, verifyOtpData, showToast, refetchCurrentUser])

  useEffect(() => {
    if (verifyOtpError) {
      sendMessage("AUTH_ERROR", verifyOtpError, "otp_verification")
      showToast(verifyOtpError, 'error')
    }
  }, [verifyOtpError, showToast])

  const validateEmail = (email: string) => {
    try {
      emailSchema.parse(email)
      setEmailError('')
      return true
    } catch (error) {
      if (error instanceof z.ZodError) {
        setEmailError(error.errors[0]?.message || 'Invalid email')
      }
      return false
    }
  }

  const handleSendOTP = () => {
    if (!validateEmail(email)) return
    sendMessage("AUTH_LOADING")
    sendOtp(email)
  }

  const handleResendOTP = () => {
    if (resendTimer > 0) return
    sendMessage("AUTH_LOADING")
    resendOtp(email)
  }

  const handleVerifyOTP = () => {
    if (otp.length !== 6) {
      showToast('Please enter a complete 6-digit code', 'error')
      return
    }
    sendMessage("AUTH_LOADING")
    verifyOtp(email, otp, poppinId)
  }

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSendOTP()
  }

  const handleOTPSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleVerifyOTP()
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const theme  = useTheme()

  if (showCreateProfileStep) {
    return (
      <CreateProfileStep
        onSuccess={() => {
          setShowCreateProfileStep(false)
          refetchCurrentUser()
          useUIStore.getState().setIsSignInModalOpen(false)
        }}
      />
    )
  }

  return (
    <Box  sx={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center"
    }}>

         <Box sx={{
          display: "flex",
          justifyContent: "center",
          width: "100%",
          pt: "20px",
          pb: "35px",
          borderRadius: "1rem"
         }}>
          <img src={ organization?.badgeUrl || logoRight} alt={`${organization?.name || "poppin"} logo`} style={{ width: 60 }} />
         </Box>


        <Typography  sx={{ textAlign: 'center', mb: 2, color: 'white', fontSize: "16px" }}>
          {step === 'email' ? 'Welcome to Poppin ' : 'Enter Verification Code'}
        </Typography>
        <Typography sx={{ textAlign: 'center', mb: "30px", color: JUICE.text3, fontSize: "14px" }}>Sign in to start commenting and <br />
        interacting with others </Typography>

        <Box sx={{
          px: 2
        }}>
        {step === 'email' ? (
          <Box component="form" onSubmit={handleEmailSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'center' }}>
            <TextField
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) {
                  validateEmail(e.target.value)
                }
              }}
              onBlur={() => validateEmail(email)}
              error={!!emailError}
              helperText={emailError}
              disabled={sendOtpLoading}
              size="small"
              autoFocus
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: JUICE.well,
                  color: 'white',
                  height: '38px',
                  borderRadius: '10px',
                  '& fieldset': {
                    borderColor: emailError ? JUICE.redSoft : JUICE.border,
                  },
                  '&:hover fieldset': {
                    borderColor: emailError ? JUICE.redSoft : 'rgba(255,255,255,0.18)',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: emailError ? JUICE.redSoft : theme.palette.primary.main,
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#9CA3AF',
                },
                '& .MuiInputBase-input': {
                  color: 'white',
                  fontSize: '0.8rem',
                  padding: '6px 10px',
                },
                '& .MuiFormHelperText-root': {
                  color: '#FF453A',
                  fontSize: '0.75rem',
                  lineHeight: 1.2,
                  marginLeft: 0,
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={sendOtpLoading || !email || !!emailError}
              size="small"
              sx={{
                backgroundColor: theme.palette.primary.main,
                color: '#000',
                border: 'none',
                borderRadius: '10px',
                py: 1,
                px: 2,
                fontSize: '0.85rem',
                fontWeight: 600,
                minHeight: '38px',
                textTransform: 'none',
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: alpha(theme.palette.primary.main, 0.85),
                  boxShadow: 'none',
                },
                '&:disabled': {
                  backgroundColor: JUICE.well,
                  color: JUICE.text3,
                },
              }}
            >
              {sendOtpLoading ? 'Sending...' : 'Send Verification Code'}
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#D1D5DB', mb: 2 }}>
                We sent a 6-digit code to <span style={{ fontWeight: 500, color: 'white' }}>{email}</span>
              </Typography>
              
              <Box component="form" onSubmit={handleOTPSubmit}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                  <MuiOtpInput
                    value={otp}
                    onChange={setOtp}
                    length={6}
                    gap={1}
                    autoFocus
                    sx={{
                      '& .MuiOtpInput-TextField': {
                        '& .MuiOutlinedInput-root': {
                          color: 'white',
                          width: '40px',
                          height: '40px',
                          backgroundColor: JUICE.well,
                          borderRadius: '10px',
                          '& fieldset': {
                            borderColor: JUICE.border,
                          },
                          '&:hover fieldset': {
                            borderColor: 'rgba(255,255,255,0.18)',
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: theme.palette.primary.main,
                          },
                        },
                        '& .MuiInputBase-input': {
                          color: 'white',
                          textAlign: 'center',
                          fontSize: '1rem',
                          fontWeight: 600,
                          padding: '8px 4px',
                        },
                      },
                    }}
                  />
                </Box>

                <Button
                  type="submit"
                  variant="contained"
                  disabled={verifyOtpLoading || otp.length !== 6}
                  sx={{
                    width: '100%',
                    mb: 2,
                    backgroundColor: theme.palette.primary.main,
                    color: '#000',
                    fontWeight: 600,
                    textTransform: 'none',
                    borderRadius: '10px',
                    py: 1,
                    px: 2,
                    fontSize: '0.875rem',
                    minHeight: '38px',
                    boxShadow: 'none',
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.85),
                      boxShadow: 'none',
                    },
                    '&:disabled': {
                      backgroundColor: JUICE.well,
                      color: JUICE.text3,
                    },
                  }}
                >
                  {verifyOtpLoading ? 'Verifying...' : 'Verify Code'}
                </Button>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <Button
                  onClick={handleResendOTP}
                  disabled={resendTimer > 0 || sendOtpLoading}
                  sx={{
                    color: theme.palette.primary.main,
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    py: 0.5,
                    px: 1,
                    minHeight: '28px',
                    '&:hover': {
                      textDecoration: 'underline',
                      backgroundColor: 'transparent',
                    },
                    '&:disabled': {
                      color: JUICE.text3,
                      textDecoration: 'none',
                    },
                  }}
                >
                  {resendTimer > 0 ? `Resend code in ${formatTime(resendTimer)}` : 'Resend code'}
                </Button>
              </Box>
            </Box>
          </Box>
        )}
        
      
        </Box>
    </Box>
  )
} 